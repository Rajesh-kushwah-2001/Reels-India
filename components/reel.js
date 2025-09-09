function createReel(video) {
  const container = document.createElement("div");
  container.className = "reel";

  const vid = document.createElement("video");
  vid.src = video.url;
  vid.controls = false;
  vid.autoplay = false;
  vid.loop = true;
  vid.muted = false;

  // Autoplay when visible
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        vid.play();
      } else {
        vid.pause();
      }
    });
  }, { threshold: 0.75 });
  observer.observe(vid);

  const actions = createActions(video);

  container.appendChild(vid);
  container.appendChild(actions);
  return container;
}
