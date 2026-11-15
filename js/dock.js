// The bottom toolbar (Stellarium style): icon buttons open one popup at a time above the bar; the location pill (bottom left)
// and the date/time pill (bottom right) open theirs. Only touches the DOM; every control keeps its own id and is wired in main.js.

import { CONFIG } from "./config.js";

export function initDock() {
  const pops = [...document.querySelectorAll(".pop")];
  const triggers = [...document.querySelectorAll("[data-pop]")];

  const closeAll = () => {
    pops.forEach((p) => p.classList.add("hidden"));
    triggers.forEach((t) => { t.classList.remove("on"); t.setAttribute("aria-expanded", "false"); });
  };
  const toggle = (id) => {
    const pop = document.getElementById(id);
    if (!pop) return;
    const wasOpen = !pop.classList.contains("hidden");
    closeAll();
    if (wasOpen) return;
    pop.classList.remove("hidden");
    triggers.filter((t) => t.dataset.pop === id).forEach((t) => { t.classList.add("on"); t.setAttribute("aria-expanded", "true"); });
    const first = pop.querySelector("input, select, button");
    if (first && window.matchMedia("(pointer: fine)").matches) first.focus({ preventScroll: true });
  };

  triggers.forEach((t) => t.addEventListener("click", () => toggle(t.dataset.pop)));
  document.querySelectorAll(".pop-close").forEach((b) => b.addEventListener("click", closeAll));
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest(".pop, [data-pop]")) closeAll(); });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(); });

  const fs = document.getElementById("fullscreen");
  if (fs) {
    if (!document.documentElement.requestFullscreen) fs.style.display = "none";
    fs.addEventListener("click", () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    });
  }

  // Location pill: the place name when it is the start-up place, otherwise the coordinates.
  const pill = document.getElementById("where-text");
  const refresh = () => {
    if (!pill) return;
    const lat = parseFloat(document.getElementById("lat").value), lon = parseFloat(document.getElementById("lon").value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const home = CONFIG.location;
    pill.textContent = home.name && Math.abs(lat - home.lat) < 0.05 && Math.abs(lon - home.lon) < 0.05
      ? home.name
      : `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
  };
  refresh();
  setInterval(refresh, 700);
}