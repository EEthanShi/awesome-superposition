/* The film card: a poster that links to YouTube, swapped for the privacy-enhanced player
   only when the visitor presses play, so the page loads nothing from YouTube until then.
   Chapter links seek the player when it is open and open YouTube at that time otherwise. */
(() => {
  "use strict";

  const player = document.getElementById("film-player");
  if (!player) return;
  const id = player.dataset.yt;

  function play(start = 0) {
    const frame = document.createElement("iframe");
    frame.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&start=${start}`;
    frame.title = "Superposition: the survey, as a film";
    frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    frame.allowFullscreen = true;
    frame.className = "film-frame";
    const stage = player.parentElement;
    stage.replaceChildren(frame);
    frame.focus();
  }

  const plain = (event) => !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button > 0);

  player.addEventListener("click", (event) => {
    if (!plain(event)) return;
    event.preventDefault();
    play(0);
  });

  document.querySelectorAll(".film-chapters a[data-t]").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (!plain(event)) return;
      event.preventDefault();
      play(Number(link.dataset.t) || 0);
      document.getElementById("film").scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  });
})();
