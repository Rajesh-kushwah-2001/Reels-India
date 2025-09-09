function createActions(video) {
  const container = document.createElement("div");
  container.className = "actions";

  // Like
  const likeBtn = document.createElement("button");
  likeBtn.innerText = `❤️ ${video.likes}`;
  likeBtn.onclick = () => {
    video.likes++;
    likeBtn.innerText = `❤️ ${video.likes}`;
  };

  // Comment
  const commentBtn = document.createElement("button");
  commentBtn.innerText = "💬";
  commentBtn.onclick = () => alert("Open comments popup");

  // Share
  const shareBtn = document.createElement("button");
  shareBtn.innerText = "↗️";
  shareBtn.onclick = async () => {
    if (navigator.share) {
      await navigator.share({
        title: "ReelIndia",
        text: "Watch this reel!",
        url: window.location.href
      });
    } else {
      alert("Share not supported on this browser");
    }
  };

  // Save
  const saveBtn = document.createElement("button");
  saveBtn.innerText = "🔖";
  saveBtn.onclick = () => alert("Saved!");

  container.appendChild(likeBtn);
  container.appendChild(commentBtn);
  container.appendChild(shareBtn);
  container.appendChild(saveBtn);

  return container;
}
