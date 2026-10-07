import { API_ORIGIN } from "../../js/config.js";

/**
 * Mikro-interaksiyalar: magnit tugmalar, 3D tilt kartalar, drag galereya,
 * cheksiz lenta (marquee) va havolalarni to'g'ri manzilga ulash.
 *
 * Har bir funksiya mustaqil — sensorli ekran yoki "kam harakat" rejimida
 * og'ir effektlar o'chadi, kontent esa to'liq ishlayveradi.
 */

export function init({ reduced, coarse }) {
  magnetic({ reduced, coarse });
  tiltCards({ reduced, coarse });
  gallery({ reduced, coarse });
  marquee();
  appLinks();
}

/** Tugmalar kursorga qarab tortiladi (magnit effekt). */
function magnetic({ reduced, coarse }) {
  if (reduced || coarse) return;
  const nodes = [...document.querySelectorAll("[data-magnetic]")];
  if (!nodes.length) return;

  const items = nodes.map((element) => ({
    element,
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
    pull: Number(element.dataset.magnetic) || 0.26,
  }));

  const onMove = (event) => {
    items.forEach((item) => {
      const box = item.element.getBoundingClientRect();
      if (!box.width) return;
      const centerX = box.left + box.width / 2;
      const centerY = box.top + box.height / 2;
      const distance = Math.hypot(event.clientX - centerX, event.clientY - centerY);
      const radius = Math.max(box.width, box.height) * 1.25;
      if (distance > radius) {
        item.targetX = 0;
        item.targetY = 0;
        return;
      }
      item.targetX = (event.clientX - centerX) * item.pull;
      item.targetY = (event.clientY - centerY) * item.pull;
    });
  };

  const loop = () => {
    items.forEach((item) => {
      item.x += (item.targetX - item.x) * 0.16;
      item.y += (item.targetY - item.y) * 0.16;
      item.element.style.transform = `translate3d(${item.x.toFixed(2)}px, ${item.y.toFixed(2)}px, 0)`;
    });
    requestAnimationFrame(loop);
  };

  window.addEventListener("pointermove", onMove, { passive: true });
  loop();
}

/** Kartalar kursor ostida 3D burchak oladi (tilt) + yorug'lik dog'i. */
function tiltCards({ reduced }) {
  if (reduced) return;
  document.querySelectorAll("[data-tilt]").forEach((card) => {
    const strength = Number(card.dataset.tilt) || 8;

    const onMove = (event) => {
      if (event.pointerType && event.pointerType !== "mouse") return;
      const box = card.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const px = (event.clientX - box.left) / box.width;
      const py = (event.clientY - box.top) / box.height;
      // Karta tashqarisida bo'lsa (masalan kursor hali kelmagan bo'lsa) effekt qo'llanmaydi
      if (px < -0.12 || px > 1.12 || py < -0.12 || py > 1.12) {
        reset();
        return;
      }
      card.style.setProperty("--mx", `${(px * 100).toFixed(2)}%`);
      card.style.setProperty("--my", `${(py * 100).toFixed(2)}%`);
      card.style.transform =
        `perspective(950px) rotateY(${((px - 0.5) * strength * 2).toFixed(2)}deg) ` +
        `rotateX(${(-(py - 0.5) * strength * 2).toFixed(2)}deg) translateY(-6px)`;
    };

    const reset = () => {
      card.style.transform = "";
    };

    card.addEventListener("pointerenter", () => card.classList.add("is-tilting"));
    card.addEventListener("pointermove", onMove);
    card.addEventListener("pointerleave", () => {
      card.classList.remove("is-tilting");
      reset();
    });
  });
}

/** Gorizontal drag galereya: tortish + inersiya, tugmalar va klaviatura bilan boshqarish. */
function gallery({ reduced, coarse }) {
  document.querySelectorAll("[data-gallery]").forEach((viewport) => {
    const track = viewport.querySelector("[data-gallery-track]");
    if (!track) return;

    const section = viewport.closest("section") || document;
    const previous = section.querySelector("[data-gallery-prev]");
    const next = section.querySelector("[data-gallery-next]");
    let current = 0;
    let target = 0;
    let velocity = 0;
    let dragging = false;
    let startX = 0;
    let startTarget = 0;
    let lastX = 0;
    let moved = 0;

    const limit = () => Math.min(0, viewport.clientWidth - track.scrollWidth);
    const clamp = (value) => Math.max(limit(), Math.min(0, value));
    const paint = () => {
      track.style.transform = `translate3d(${current.toFixed(2)}px, 0, 0)`;
    };

    const loop = () => {
      if (!dragging) {
        velocity *= 0.93;
        if (Math.abs(velocity) < 0.02) velocity = 0;
        target = clamp(target + velocity);
      }
      current += (target - current) * (reduced ? 1 : 0.14);
      if (Math.abs(target - current) < 0.05) current = target;
      paint();
      requestAnimationFrame(loop);
    };

    const onDown = (event) => {
      if (event.pointerType === "touch" && coarse) return; // sensorli ekranda tabiiy scroll qoladi
      dragging = true;
      moved = 0;
      startX = event.clientX;
      lastX = event.clientX;
      startTarget = target;
      velocity = 0;
      viewport.classList.add("is-dragging");
      viewport.setPointerCapture?.(event.pointerId);
    };

    const onMove = (event) => {
      if (!dragging) return;
      const delta = event.clientX - startX;
      moved = Math.abs(delta);
      target = clamp(startTarget + delta);
      velocity = (event.clientX - lastX) * 0.85;
      lastX = event.clientX;
      event.preventDefault();
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      viewport.classList.remove("is-dragging");
    };

    const step = (direction) => {
      const card = track.querySelector(".gallery-card");
      const width = card ? card.getBoundingClientRect().width + 22 : viewport.clientWidth * 0.7;
      target = clamp(target - direction * width);
      velocity = 0;
    };

    viewport.addEventListener("pointerdown", onDown);
    viewport.addEventListener("pointermove", onMove);
    viewport.addEventListener("pointerup", onUp);
    viewport.addEventListener("pointercancel", onUp);
    viewport.addEventListener("pointerleave", onUp);
    viewport.addEventListener("click", (event) => {
      if (moved > 8) event.preventDefault(); // drag paytida tasodifiy bosishni to'xtatamiz
    });
    previous?.addEventListener("click", () => step(-1));
    next?.addEventListener("click", () => step(1));
    viewport.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
    });
    window.addEventListener("resize", () => {
      current = clamp(current);
      target = current;
      paint();
    });

    paint();
    loop();
  });
}

/** Cheksiz lenta: trekni nusxalab uzluksiz harakat hosil qiladi. */
function marquee() {
  document.querySelectorAll("[data-marquee]").forEach((marquee) => {
    const track = marquee.querySelector("[data-marquee-track]");
    if (!track) return;
    const copy = track.cloneNode(true);
    copy.setAttribute("aria-hidden", "true");
    copy.removeAttribute("data-marquee-track");
    marquee.appendChild(copy);
  });
}

/** "Navo AI'ni ochish" havolalarini joriy muhitga moslab ulaydi. */
function appLinks() {
  const target = new URL("/", API_ORIGIN).href;
  document.querySelectorAll("[data-app-link]").forEach((link) => link.setAttribute("href", target));
  document.querySelectorAll("[data-api-origin]").forEach((label) => {
    label.textContent = new URL(API_ORIGIN).host;
  });
}