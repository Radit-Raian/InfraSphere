// Drag to look around, wheel or pinch to zoom, arrow keys and +/- too. A short tap is reported as a click.

import { D2R } from "./astro.js";

export function attachControls(canvas, view, hooks) {
  const pointers = new Map();
  let pinchDist = 0;
  let down = null;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.classList.add("dragging");
    down = pointers.size === 1 ? { t: performance.now(), moved: 0 } : null;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
    hooks.onInteract();
  });

  canvas.addEventListener("pointermove", (e) => {
    const [px, py] = pos(e);
    const p = pointers.get(e.pointerId);
    if (!p) { hooks.onHover(px, py); return; }
    hooks.onInteract();
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (down) down.moved += Math.abs(dx) + Math.abs(dy);
    if (pointers.size === 1) {
      const degPerPx = (view.fov / D2R) / view.H;
      view.az -= dx * degPerPx * D2R;
      view.alt += dy * degPerPx * D2R;
      view.clamp();
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) { view.fov *= pinchDist / dist; view.clamp(); }
      pinchDist = dist;
    }
  });

  const end = (e) => {
    const wasOne = pointers.size === 1;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (pointers.size === 0) canvas.classList.remove("dragging");
    if (e.type === "pointerup" && wasOne && down && down.moved < 6 && performance.now() - down.t < 500) {
      const [px, py] = pos(e);
      hooks.onClick(px, py);
    }
    if (pointers.size === 0) down = null;
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("pointerleave", () => hooks.onLeave());

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    hooks.onInteract();
    view.fov *= Math.exp(e.deltaY * 0.0012);
    view.clamp();
  }, { passive: false });

  window.addEventListener("keydown", (e) => {
    if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
    const step = Math.max(0.5, view.fov / D2R / 30) * D2R;
    if (e.key === "ArrowLeft") view.az -= step;
    else if (e.key === "ArrowRight") view.az += step;
    else if (e.key === "ArrowUp") view.alt += step;
    else if (e.key === "ArrowDown") view.alt -= step;
    else if (e.key === "+" || e.key === "=") view.fov *= 0.9;
    else if (e.key === "-") view.fov *= 1.1;
    else return;
    hooks.onInteract();
    view.clamp();
  });

  return { isInteracting: () => pointers.size > 0 };
}
