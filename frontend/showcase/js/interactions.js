import { API_ORIGIN } from "../../js/config.js";

/**
 * Mikro-interaksiyalar: magnit tugmalar, 3D tilt kartalar, drag galereya,
 * cheksiz lenta (marquee) va havolalarni to'g'ri manzilga ulash.
 *
 * Har bir funksiya mustaqil — sensorli ekran yoki "kam harakat" rejimida
 * og'ir effektlar o'chadi, kontent esa to'liq ishlayveradi.
 */

export function init({ reduced, coarse }) {
  const cleanups = [
    customCursor(),
    magnetic({ reduced, coarse }),
    tiltCards({ reduced, coarse }),
  ].filter(Boolean);
  gallery({ reduced, coarse });
  marquee();
  appLinks();
  return () => cleanups.forEach((cleanup) => cleanup());
}

/** Standart cursorni yashirmaydigan, faqat hover/mouse qurilmalaridagi indikator. */
function customCursor() {
  const hasMousePointer = window.matchMedia("(any-hover: hover) and (any-pointer: fine)").matches;
  if (!hasMousePointer || document.querySelector(".showcase-cursor")) return null;

  const root = document.createElement("div");
  root.className = "showcase-cursor";
  root.setAttribute("aria-hidden", "true");
  const dot = document.createElement("span");
  dot.className = "showcase-cursor-dot";
  const ring = document.createElement("span");
  ring.className = "showcase-cursor-ring";
  root.append(dot, ring);
  document.body.appendChild(root);

  const position = { x: 0, y: 0, ringX: 0, ringY: 0 };
  let frame = 0;
  let visible = false;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const render = () => {
    frame = 0;
    position.ringX += (position.x - position.ringX) * 0.38;
    position.ringY += (position.y - position.ringY) * 0.38;
    ring.style.transform = `translate3d(${position.ringX.toFixed(2)}px,${position.ringY.toFixed(2)}px,0) translate(-50%,-50%)`;
    if (Math.abs(position.x - position.ringX) > 0.25 || Math.abs(position.y - position.ringY) > 0.25) {
      frame = requestAnimationFrame(render);
    }
  };

  const onMove = (event) => {
    if (event.pointerType && event.pointerType !== "mouse") {
      hide();
      return;
    }
    position.x = event.clientX;
    position.y = event.clientY;
    dot.style.transform = `translate3d(${position.x}px,${position.y}px,0) translate(-50%,-50%)`;
    const target = event.target instanceof Element ? event.target : null;
    const interactive = target?.closest("a[href],button:not(:disabled),[role='button'],[data-tilt]");
    const textEntry = !interactive && Boolean(target?.closest("input,textarea,select,[contenteditable='true']"));
    root.classList.toggle("is-interactive", Boolean(interactive));
    root.classList.toggle("is-text-entry", textEntry);
    root.classList.add("is-visible");
    visible = true;
    if (reducedMotion.matches) {
      position.ringX = position.x;
      position.ringY = position.y;
      ring.style.transform = dot.style.transform;
      return;
    }
    if (!frame) frame = requestAnimationFrame(render);
  };

  const hide = (event) => {
    if (event?.relatedTarget instanceof Node) return;
    root.classList.remove("is-visible", "is-interactive", "is-text-entry");
    visible = false;
    cancelAnimationFrame(frame);
    frame = 0;
  };

  const onMotionChange = () => {
    if (reducedMotion.matches && visible) {
      position.ringX = position.x;
      position.ringY = position.y;
      ring.style.transform = dot.style.transform;
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };

  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerout", hide);
  window.addEventListener("blur", hide);
  reducedMotion.addEventListener("change", onMotionChange);
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerout", hide);
    window.removeEventListener("blur", hide);
    reducedMotion.removeEventListener("change", onMotionChange);
    root.remove();
  };
}

/** Tugmalar kursorga qarab tortiladi (magnit effekt). */
function magnetic({ reduced, coarse }) {
  if (reduced || coarse) return;
  const nodes = [...document.querySelectorAll("[data-magnetic]:not(.btn)")];
  if (!nodes.length) return;

  const items = nodes.map((element) => ({
    element,
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
  }));
  let frame = 0;

  const onMove = (event) => {
    if (event.pointerType && event.pointerType !== "mouse") return;
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
      const pull = Number(item.element.dataset.magnetic) || 0.26;
      item.targetX = Math.max(-4, Math.min(4, (event.clientX - centerX) * pull));
      item.targetY = Math.max(-4, Math.min(4, (event.clientY - centerY) * pull));
    });
    schedule();
  };

  const reset = () => {
    items.forEach((item) => {
      item.targetX = 0;
      item.targetY = 0;
    });
    schedule();
  };

  const animate = () => {
    frame = 0;
    let moving = false;
    items.forEach((item) => {
      item.x += (item.targetX - item.x) * 0.16;
      item.y += (item.targetY - item.y) * 0.16;
      item.element.style.setProperty("--magnet-x", `${item.x.toFixed(2)}px`);
      item.element.style.setProperty("--magnet-y", `${item.y.toFixed(2)}px`);
      if (Math.abs(item.targetX - item.x) > 0.04 || Math.abs(item.targetY - item.y) > 0.04) moving = true;
    });
    if (moving) frame = requestAnimationFrame(animate);
    else {
      items.forEach(({ element }) => {
        element.style.removeProperty("--magnet-x");
        element.style.removeProperty("--magnet-y");
      });
    }
  };

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(animate);
  };

  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerleave", reset);
  return () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerleave", reset);
    if (frame) cancelAnimationFrame(frame);
    items.forEach(({ element }) => {
      element.style.removeProperty("--magnet-x");
      element.style.removeProperty("--magnet-y");
    });
  };
}

/** Kartalar kursor ostida 3D burchak oladi (tilt) + yorug'lik dog'i. */
function tiltCards({ reduced, coarse }) {
  if (reduced || coarse) return;
  const items = [];
  document.querySelectorAll(".tilt, [data-tilt], [data-magnetic]:not(.btn)").forEach((card) => {
    const strength = Number(card.dataset.tilt) || 8;
    const item = { card, strength, x: 0, y: 0, targetX: 0, targetY: 0, hovering: false };
    items.push(item);

    const onMove = (event) => {
      if (event.pointerType && event.pointerType !== "mouse") return;
      const box = card.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const px = (event.clientX - box.left) / box.width;
      const py = (event.clientY - box.top) / box.height;
      // Karta tashqarisida bo'lsa (masalan kursor hali kelmagan bo'lsa) effekt qo'llanmaydi
      if (px < -0.12 || px > 1.12 || py < -0.12 || py > 1.12) {
        item.targetX = 0;
        item.targetY = 0;
        return;
      }
      card.style.setProperty("--mx", `${(px * 100).toFixed(2)}%`);
      card.style.setProperty("--my", `${(py * 100).toFixed(2)}%`);
      item.targetY = (px - 0.5) * strength * 2;
      item.targetX = -(py - 0.5) * strength * 2;
      schedule();
    };

    const onEnter = () => {
      item.hovering = true;
      card.classList.add("is-tilting");
    };
    const onLeave = () => {
      item.hovering = false;
      item.targetX = 0;
      item.targetY = 0;
      card.classList.remove("is-tilting");
      schedule();
    };
    card.addEventListener("pointerenter", onEnter);
    card.addEventListener("pointermove", onMove);
    card.addEventListener("pointerleave", onLeave);
    item.cleanup = () => {
      card.removeEventListener("pointerenter", onEnter);
      card.removeEventListener("pointermove", onMove);
      card.removeEventListener("pointerleave", onLeave);
      card.classList.remove("is-tilting");
      card.style.removeProperty("transform");
      card.style.removeProperty("--mx");
      card.style.removeProperty("--my");
    };
  });

  let frame = 0;
  const animate = () => {
    frame = 0;
    let moving = false;
    items.forEach((item) => {
      item.x += (item.targetX - item.x) * 0.18;
      item.y += (item.targetY - item.y) * 0.18;
      const card = item.card;
      if (Math.abs(item.targetX - item.x) > 0.04 || Math.abs(item.targetY - item.y) > 0.04) {
        card.style.transform =
          `perspective(950px) rotateY(${item.x.toFixed(2)}deg) rotateX(${item.y.toFixed(2)}deg)` +
          (card.matches(".btn") ? "" : " translateY(-4px)");
        moving = true;
      } else if (!item.hovering) {
        item.x = 0;
        item.y = 0;
        card.style.removeProperty("transform");
      }
    });
    if (moving) frame = requestAnimationFrame(animate);
  };

  function schedule() {
    if (!frame) frame = requestAnimationFrame(animate);
  }

  return () => {
    if (frame) cancelAnimationFrame(frame);
    items.forEach((item) => item.cleanup());
  };
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

/** Ilovaga boradigan havolalarni joriy domen ostidagi /app manziliga bog'laydi. */
function appLinks() {
  document.querySelectorAll("[data-app-link]").forEach((link) => link.setAttribute("href", "/app"));
  document.querySelectorAll("[data-api-origin]").forEach((label) => {
    label.textContent = window.location.host;
  });
}