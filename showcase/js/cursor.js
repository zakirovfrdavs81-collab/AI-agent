/**
 * Suyuq (inertiyali) maxsus kursor.
 *
 *  - asosiy nuqta darhol, halqa esa sekin ergashadi (inertia)
 *  - [data-cursor="Izoh"] elementlar ustida halqa kattalashib izoh matnini ko'rsatadi
 *  - harakat ortidan qisqa umr ko'radigan zarrachalar izi (particle trail) qoladi
 *
 * Sensorli ekran yoki "kam harakat" rejimida modul ishga tushmaydi (null qaytaradi).
 */

const TARGET = "[data-cursor]";
const MAX_PARTICLES = 70;
const COLORS = ["169,142,255", "140,228,206", "236,232,255"];

export function init({ coarse, reduced }) {
  if (coarse || reduced) return null;

  const dot = document.querySelector("[data-cursor-dot]");
  const ring = document.querySelector("[data-cursor-ring]");
  const label = ring ? ring.querySelector("[data-cursor-label]") : null;
  const canvas = document.querySelector("[data-cursor-trail]");
  if (!dot || !ring || !canvas) return null;

  const surface = canvas.getContext("2d");
  const pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const dotPos = { ...pointer };
  const ringPos = { ...pointer };
  const particles = [];
  let frame = 0;
  let last = { ...pointer };
  let visible = true;
  let hidden = false;
  let dpr = 1;

  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    if (surface) surface.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const spawn = (x, y) => {
    if (particles.length >= MAX_PARTICLES) return;
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.12 + Math.random() * 0.55;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      size: 0.7 + Math.random() * 2.3,
      color: COLORS[(Math.random() * COLORS.length) | 0],
    });
  };

  const paint = () => {
    if (!surface) return;
    surface.clearRect(0, 0, window.innerWidth, window.innerHeight);
    surface.globalCompositeOperation = "lighter";
    for (let index = particles.length - 1; index >= 0; index -= 1) {
      const grain = particles[index];
      grain.life -= 0.024;
      if (grain.life <= 0) {
        particles.splice(index, 1);
        continue;
      }
      grain.x += grain.vx;
      grain.y += grain.vy;
      grain.vy += 0.007;
      surface.beginPath();
      surface.fillStyle = `rgba(${grain.color},${(grain.life * 0.45).toFixed(3)})`;
      surface.arc(grain.x, grain.y, grain.size * grain.life, 0, Math.PI * 2);
      surface.fill();
    }
    surface.globalCompositeOperation = "source-over";
  };

  const render = () => {
    dotPos.x += (pointer.x - dotPos.x) * 0.38;
    dotPos.y += (pointer.y - dotPos.y) * 0.38;
    ringPos.x += (pointer.x - ringPos.x) * 0.14;
    ringPos.y += (pointer.y - ringPos.y) * 0.14;
    dot.style.transform = `translate3d(${dotPos.x}px, ${dotPos.y}px, 0)`;
    ring.style.transform = `translate3d(${ringPos.x}px, ${ringPos.y}px, 0)`;
    paint();
    frame = requestAnimationFrame(render);
  };

  const start = () => {
    if (frame) return;
    frame = requestAnimationFrame(render);
  };

  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };

  const onTouch = () => {
    // Sensorli ekranda kursor butunlay o'chadi (qurilma almashsa ham xavfsiz)
    visible = false;
    hidden = true;
    document.documentElement.classList.remove("has-cursor");
    clearState();
    stop();
  };

  const onMove = (event) => {
    if (event.pointerType === "touch") {
      onTouch();
      return;
    }
    if (hidden) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    const distance = Math.hypot(pointer.x - last.x, pointer.y - last.y);
    if (distance > 7) {
      spawn(pointer.x, pointer.y);
      last = { x: pointer.x, y: pointer.y };
    }
    if (!visible) {
      visible = true;
      document.documentElement.classList.add("has-cursor");
    }
  };

  const setState = (element) => {
    const text = element.dataset.cursor;
    ring.classList.add("is-active");
    if (label) label.textContent = text || "";
    ring.classList.toggle("is-view", !text);
  };

  const clearState = () => {
    ring.classList.remove("is-active", "is-view");
    if (label) label.textContent = "";
  };

  const onOver = (event) => {
    const element = event.target instanceof Element ? event.target.closest(TARGET) : null;
    if (element) setState(element);
  };

  const onOut = (event) => {
    const element = event.target instanceof Element ? event.target.closest(TARGET) : null;
    if (element) clearState();
  };

  const onLeave = () => {
    visible = false;
    document.documentElement.classList.remove("has-cursor");
  };

  const onVisibility = () => (document.hidden ? stop() : start());

  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch") onTouch();
    else if (!hidden) spawn(pointer.x, pointer.y);
  });
  window.addEventListener("touchstart", onTouch, { passive: true });
  document.addEventListener("pointerover", onOver);
  document.addEventListener("pointerout", onOut);
  document.addEventListener("visibilitychange", onVisibility);
  document.addEventListener("mouseleave", onLeave);
  start();

  return {
    destroy() {
      stop();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("mouseleave", onLeave);
    },
  };
}
