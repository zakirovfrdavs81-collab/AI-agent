/**
 * Navo AI showcase — kirish nuqtasi.
 *
 * Modullar ketma-ket va xatoga chidamli tarzda ishga tushiriladi: biri yiqilsa
 * qolganlari ishlashda davom etadi, sahifa esa hech qachon bo'sh qolmaydi.
 */

const LOADERS = {
  scroll: () => import("./smooth-scroll.js"),
  reveal: () => import("./reveal.js"),
  cursor: () => import("./cursor.js"),
  scene: () => import("./scene.js"),
  interactions: () => import("./interactions.js"),
};

const context = {
  reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  coarse: window.matchMedia("(hover: none), (pointer: coarse)").matches,
  small: window.matchMedia("(max-width: 900px)").matches,
};

async function boot() {
  const results = {};

  for (const [name, load] of Object.entries(LOADERS)) {
    try {
      const module = await load();
      results[name] = await module.init(context);
      document.documentElement.classList.add(`has-${name}`);
    } catch (error) {
      console.warn(`[showcase] «${name}» moduli ishga tushmadi:`, error);
    }
  }

  const preloader = document.querySelector("[data-preloader]");
  window.setTimeout(() => preloader?.classList.add("is-done"), 240);
  window.setTimeout(() => {
    const hero = document.querySelector("[data-hero]");
    hero?.classList.add("is-visible");
    results.reveal?.splitReady?.forEach((play) => play());
    results.scroll?.ScrollTrigger?.refresh?.();
  }, 430);
  window.setTimeout(() => preloader?.remove(), 1400);

  // Xavfsizlik to'ri: reveal moduli ishlamasa kontent baribir ko'rinadi
  if (!results.reveal) {
    document.querySelectorAll("[data-reveal]").forEach((element) => element.classList.add("is-visible"));
  } else {
    document.documentElement.classList.add("reveal-ready");
  }

  document.documentElement.dataset.ready = "1";
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}