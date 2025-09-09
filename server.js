require('dotenv').config();
const express = require("express");
const path = require("path");
const multer = require("multer");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const app = express();
const PORT = process.env.PORT || 5000;
const SECRET = process.env.SECRET;

// MongoDB कनेक्शन
mongoose.connect(process.env.MONGODB_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.error("Mongo Error:", err));

// User Schema
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: { type: String },
  profilePic: { type: String, default: "/default.png" },
  reels: [{
    title: String,
    file: String,
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 }
  }],
  analytics: {
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 }
  },
  followers: [String],
  following: [String]
});
const User = mongoose.model("User", userSchema);

// Message Schema for Chat
const messageSchema = new mongoose.Schema({
  sender: String,
  receiver: String,
  content: String,
  timestamp: { type: Date, default: Date.now },
  read: { type: Boolean, default: false }
});
const Message = mongoose.model("Message", messageSchema);

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Static folders
app.use(express.static(path.join(__dirname, "public")));
app.use("/public/pages", express.static(path.join(__dirname, "public/pages")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Nodemailer Setup
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

let otpStore = {};

// Auth middleware
function authMiddleware(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return res.status(401).json({ success: false, message: "No token" });
  const token = authHeader.split(" ")[1];
  jwt.verify(token, SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ success: false, message: "Invalid token" });
    req.email = decoded.email;
    next();
  });
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/pages", "login.html"));
});

// Send OTP
app.post("/send-otp", async (req, res) => {
  try {
    const { email } = req.body;
    const otp = Math.floor(100000 + Math.random() * 900000);
    const expiry = Date.now() + 2 * 60 * 1000;
    otpStore[email] = { otp, expiry };
    console.log("✅ OTP for", email, "is:", otp);
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: email,
      subject: "Your OTP Code",
      text: `Your OTP is ${otp}. It will expire in 2 minutes.`,
    });
    res.json({ success: true, message: "OTP sent successfully!" });
  } catch (err) {
    console.error("OTP Send Error:", err);
    res.json({ success: false, message: "Error sending OTP" });
  }
});

// Verify OTP
app.post("/verify-otp", async (req, res) => {
  const { email, otp } = req.body;
  if (!otpStore[email]) return res.json({ success: false, message: "OTP not found!" });
  const { otp: storedOtp, expiry } = otpStore[email];
  if (Date.now() > expiry) {
    delete otpStore[email];
    return res.json({ success: false, message: "OTP expired!" });
  }
  if (storedOtp == otp) {
    delete otpStore[email];
    let user = await User.findOne({ email });
    if (!user) {
      user = new User({
        name: email.split("@")[0],
        email,
      });
      await user.save();
    }
    const token = jwt.sign({ email }, SECRET, { expiresIn: "1h" });
    return res.json({ success: true, token, user });
  } else {
    return res.json({ success: false, message: "Invalid OTP!" });
  }
});

// Password Signup
app.post("/api/signup", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.json({ success: false, message: "All fields required" });
  let exists = await User.findOne({ email });
  if (exists) return res.json({ success: false, message: "Email already registered" });
  const hash = await bcrypt.hash(password, 10);
  const user = new User({ name, email, password: hash });
  await user.save();
  res.json({ success: true });
});

// Password Login
app.post("/api/password-login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user || !user.password) return res.json({ success: false, message: "User not found" });
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.json({ success: false, message: "Invalid password" });
  const token = jwt.sign({ email }, SECRET, { expiresIn: "1h" });
  res.json({ success: true, token, user });
});

// Change Password API
app.post("/api/change-password", authMiddleware, async (req, res) => {
  const email = req.email;
  const { password } = req.body;
  if (!password || password.length < 6) return res.json({ success: false, message: "Password too short" });
  const hash = await bcrypt.hash(password, 10);
  let user = await User.findOne({ email });
  if (!user) return res.json({ success: false, message: "User not found" });
  user.password = hash;
  await user.save();
  res.json({ success: true });
});

// Get user data
app.get("/api/user-data", authMiddleware, async (req, res) => {
  const email = req.query.email || req.email;
  const user = await User.findOne({ email });
  if (user) return res.json(user);
  res.json(null);
});

// Update profile
const profileUpload = multer({ dest: "uploads/" });
app.post("/api/update-profile", authMiddleware, profileUpload.single("profilePic"), async (req, res) => {
  const email = req.email;
  let user = await User.findOne({ email });
  if (!user) return res.json({ success: false, message: "User not found" });
  if (req.body.name) user.name = req.body.name;
  if (req.file) user.profilePic = "/uploads/" + req.file.filename;
  await user.save();
  res.json({ success: true, user });
});

// Upload reel
const videoUpload = multer({ dest: "uploads/" });
app.post("/api/upload-reel", authMiddleware, videoUpload.single("video"), async (req, res) => {
  const email = req.email;
  let user = await User.findOne({ email });
  if (!user) return res.json({ success: false, message: "User not found" });
  if (req.file) {
    const reel = {
      title: req.body.title || "Untitled",
      file: "/uploads/" + req.file.filename,
    };
    user.reels.push(reel);
    await user.save();
    return res.json({ success: true, message: "Reel uploaded!", reels: user.reels });
  } else {
    res.json({ success: false, message: "No file uploaded!" });
  }
});

// Like reel
app.post("/api/like-reel", authMiddleware, async (req, res) => {
  const { file } = req.body;
  const users = await User.find({ "reels.file": file });
  if (users.length > 0) {
    const owner = users[0];
    const reel = owner.reels.find(r => r.file === file);
    reel.likes++;
    owner.analytics.likes++;
    await owner.save();
    return res.json({ success: true, likes: reel.likes });
  }
  res.json({ success: false, message: "Reel not found" });
});

// View reel
app.post("/api/view-reel", authMiddleware, async (req, res) => {
  const { file } = req.body;
  const users = await User.find({ "reels.file": file });
  if (users.length > 0) {
    const owner = users[0];
    const reel = owner.reels.find(r => r.file === file);
    reel.views++;
    owner.analytics.views++;
    await owner.save();
    return res.json({ success: true, views: reel.views });
  }
  res.json({ success: false, message: "Reel not found" });
});

// All reels (Feed page के लिए)
app.get("/api/all-reels", authMiddleware, async (req, res) => {
  const users = await User.find({});
  let reels = [];
  users.forEach(u => {
    u.reels.forEach(reel => {
      reels.push({
        ...reel.toObject(),
        email: u.email,
        name: u.name,
        profilePic: u.profilePic,
      });
    });
  });
  res.json(reels);
});

// Follow/Unfollow
app.post("/api/follow", authMiddleware, async (req, res) => {
  const myEmail = req.email;
  const { target } = req.body;
  if (myEmail === target) return res.json({ success: false, message: "Can't follow yourself" });
  const me = await User.findOne({ email: myEmail });
  const targetUser = await User.findOne({ email: target });
  if (!me || !targetUser) return res.json({ success: false, message: "User not found" });
  const alreadyFollowing = me.following.includes(target);
  if (alreadyFollowing) {
    me.following = me.following.filter(u => u !== target);
    targetUser.followers = targetUser.followers.filter(u => u !== myEmail);
    await me.save();
    await targetUser.save();
    return res.json({ success: true, action: "unfollow" });
  } else {
    me.following.push(target);
    targetUser.followers.push(myEmail);
    await me.save();
    await targetUser.save();
    return res.json({ success: true, action: "follow" });
  }
});

// Get Followers List
app.get("/api/followers/:email", authMiddleware, async (req, res) => {
  try {
    const email = req.params.email;
    const user = await User.findOne({ email });
    if (!user) return res.json({ success: false, message: "User not found" });
    
    const followersData = [];
    for (const followerEmail of user.followers) {
      const follower = await User.findOne({ email: followerEmail });
      if (follower) {
        followersData.push({
          name: follower.name,
          email: follower.email,
          profilePic: follower.profilePic
        });
      }
    }
    
    res.json({ success: true, followers: followersData });
  } catch (err) {
    console.error("Error fetching followers:", err);
    res.json({ success: false, message: "Error fetching followers" });
  }
});

// Get Following List
app.get("/api/following/:email", authMiddleware, async (req, res) => {
  try {
    const email = req.params.email;
    const user = await User.findOne({ email });
    if (!user) return res.json({ success: false, message: "User not found" });
    
    const followingData = [];
    for (const followingEmail of user.following) {
      const following = await User.findOne({ email: followingEmail });
      if (following) {
        followingData.push({
          name: following.name,
          email: following.email,
          profilePic: following.profilePic
        });
      }
    }
    
    res.json({ success: true, following: followingData });
  } catch (err) {
    console.error("Error fetching following:", err);
    res.json({ success: false, message: "Error fetching following" });
  }
});

// Get Chat Users (Following/Followers)
app.get("/api/chat-users", authMiddleware, async (req, res) => {
  try {
    const myEmail = req.email;
    const user = await User.findOne({ email: myEmail });
    const allContactEmails = [...new Set([...user.following, ...user.followers])];
    const contacts = [];
    
    for (const email of allContactEmails) {
      const contact = await User.findOne({ email });
      if (contact) {
        // Get last message
        const lastMessage = await Message.findOne({
          $or: [
            { sender: myEmail, receiver: email },
            { sender: email, receiver: myEmail }
          ]
        }).sort({ timestamp: -1 });
        
        contacts.push({
          name: contact.name,
          email: contact.email,
          profilePic: contact.profilePic,
          lastMessage: lastMessage ? (lastMessage.content.length > 50 ? lastMessage.content.substring(0, 50)+'...' : lastMessage.content) : null,
          lastMessageTime: lastMessage ? lastMessage.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null
        });
      }
    }
    
    // Sort by last message time
    contacts.sort((a,b) => {
      if(!a.lastMessageTime) return 1;
      if(!b.lastMessageTime) return -1;
      return new Date(b.lastMessageTime) - new Date(a.lastMessageTime);
    });
    
    res.json({ success: true, users: contacts });
  } catch (err) {
    console.error("Error fetching chat users:", err);
    res.json({ success: false, message: "Error fetching users" });
  }
});

// Search Users
app.get("/api/search-users", authMiddleware, async (req, res) => {
  try {
    const query = req.query.q;
    if (!query || query.length < 2) {
      return res.json({ success: true, users: [] });
    }
    
    const users = await User.find({
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { email: { $regex: query, $options: 'i' } }
      ]
    }).limit(20);
    
    const searchResults = users
      .filter(user => user.email !== req.email)
      .map(user => ({
        name: user.name,
        email: user.email,
        profilePic: user.profilePic
      }));
    
    res.json({ success: true, users: searchResults });
  } catch (err) {
    console.error("Error searching users:", err);
    res.json({ success: false, message: "Error searching users" });
  }
});

// Send Message
app.post("/api/send-message", authMiddleware, async (req, res) => {
  try {
    const { to, content } = req.body;
    const sender = req.email;
    
    if (!to || !content || content.trim().length === 0) {
      return res.json({ success: false, message: "Missing required fields" });
    }
    
    // Check if receiver exists
    const receiver = await User.findOne({ email: to });
    if (!receiver) {
      return res.json({ success: false, message: "User not found" });
    }
    
    const message = new Message({
      sender,
      receiver: to,
      content: content.trim()
    });
    
    await message.save();
    console.log(`✅ Message sent from ${sender} to ${to}: ${content.substring(0, 30)}...`);
    res.json({ success: true, message: "Message sent successfully" });
  } catch (err) {
    console.error("Error sending message:", err);
    res.json({ success: false, message: "Error sending message" });
  }
});

// Get Messages
app.get("/api/messages/:userEmail", authMiddleware, async (req, res) => {
  try {
    const myEmail = req.email;
    const otherEmail = req.params.userEmail;
    
    const messages = await Message.find({
      $or: [
        { sender: myEmail, receiver: otherEmail },
        { sender: otherEmail, receiver: myEmail }
      ]
    }).sort({ timestamp: 1 }).limit(100);
    
    // Mark messages as read
    await Message.updateMany(
      { sender: otherEmail, receiver: myEmail, read: false },
      { read: true }
    );
    
    res.json({ success: true, messages });
  } catch (err) {
    console.error("Error fetching messages:", err);
    res.json({ success: false, message: "Error fetching messages" });
  }
});

// Forgot Password API
app.post("/api/forgot-password", async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.json({ success: false, message: "Email not registered" });
  const resetOtp = Math.floor(100000 + Math.random() * 900000);
  const expiry = Date.now() + 10 * 60 * 1000; // 10 minutes
  otpStore[email + "_reset"] = { otp: resetOtp, expiry };
  try {
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: email,
      subject: "Password Reset OTP",
      text: `Your password reset OTP is ${resetOtp}. It will expire in 10 minutes.`,
    });
    console.log("✅ Reset OTP for", email, "is:", resetOtp);
    res.json({ success: true, message: "Reset OTP sent to your email" });
  } catch (err) {
    console.error("Reset OTP Send Error:", err);
    res.json({ success: false, message: "Failed to send reset email" });
  }
});

// Reset Password with OTP Verification
app.post("/api/reset-password-verify", async (req, res) => {
  const { email, otp, newPassword } = req.body;
  const resetKey = email + "_reset";
  console.log("✅ Reset verification attempt for:", email, "OTP:", otp);
  if (!otpStore[resetKey]) {
    console.log("❌ Reset OTP not found for:", email);
    return res.json({ success: false, message: "Reset OTP not found!" });
  }
  const { otp: storedOtp, expiry } = otpStore[resetKey];
  if (Date.now() > expiry) {
    delete otpStore[resetKey];
    console.log("❌ Reset OTP expired for:", email);
    return res.json({ success: false, message: "Reset OTP expired!" });
  }
  if (storedOtp == otp) {
    delete otpStore[resetKey];
    
    // Validate new password
    if (!newPassword || newPassword.length < 6) {
      return res.json({ success: false, message: "Password must be at least 6 characters" });
    }
    
    try {
      // Hash and save new password
      const hash = await bcrypt.hash(newPassword, 10);
      let user = await User.findOne({ email });
      if (!user) return res.json({ success: false, message: "User not found" });
      
      user.password = hash;
      await user.save();
      
      console.log("✅ Password reset successful for:", email);
      res.json({ success: true, message: "Password reset successful!" });
    } catch (err) {
      console.error("Password reset error:", err);
      res.json({ success: false, message: "Failed to reset password" });
    }
  } else {
    console.log("❌ Invalid reset OTP for:", email, "Expected:", storedOtp, "Got:", otp);
    return res.json({ success: false, message: "Invalid reset OTP!" });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ ReelIndia running at http://localhost:${PORT}`);
  console.log(`➡️ Login:   http://localhost:${PORT}/public/pages/login.html`);
  console.log(`➡️ Feed:    http://localhost:${PORT}/public/pages/index.html`);
  console.log(`➡️ Profile: http://localhost:${PORT}/public/pages/profile.html`);
  console.log(`➡️ Chat:    http://localhost:${PORT}/public/pages/chat.html`);
});
