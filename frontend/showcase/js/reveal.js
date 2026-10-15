/**
 * Matn kinetikasi, scroll-reveal va raqam hisoblagichlari.
 *
 *  - [data-split="char|word"] matnni bo'laklarga ajratadi (kinetic typography)
 *  - gradient sarlavhalar bo'laklarga bo'linganda ham yaxlit gradient saqlanadi
 *  - [data-reveal] bloklar ScrollTrigger bilan navbatma-navbat ochiladi
 *  - GSAP bo'lmasa IntersectionObserver + CSS o'tishlari ishlaydi (xavfsiz zaxira)
 */

const splitReady = [];

export function init({ reduced }) {
  const gsap = window.gsap;
  const ScrollTrigger = window.ScrollTrigger;
  const useGsap = Boolean(gsap && ScrollTrigger && !reduced);

  const splitPieces = new Map();
  document.querySelectorAll("[data-split]").forEach((element) => {
    const pieces = splitElement(element, element.dataset.split || "word");
    splitPieces.set(element, pieces);
    paintGradient(element, pieces);
  });

  const onLoad = [...document.querySelectorAll("[data-reveal][data-reveal-on='load']")];
  onLoad.forEach((element) => {
    element.dataset.revealHandled = "1";
  });

  const revealElements = [...document.querySelectorAll("[data-reveal]:not([data-reveal-handled])")];
  if (useGsap) {
    revealElements.forEach((element, index) => {
      const card = element.matches("[data-tilt], .tilt");
      const target = card ? element.querySelector(".tilt-inner") || element : element;
      const direction = element.dataset.revealDirection || ["left", "right", "up"][index % 3];
      const effect = element.dataset.revealEffect;
      const spinTargets = [...element.querySelectorAll("[data-reveal-spin]")];
      const directionOffset = {
        left: { x: card ? -32 : -56, y: card ? 24 : 12, rotation: -1.5, rotationX: 4, rotationY: -8 },
        right: { x: card ? 32 : 56, y: card ? 24 : 12, rotation: 1.5, rotationX: 4, rotationY: 8 },
        up: { x: 0, y: card ? 32 : 42, rotation: 0, rotationX: -7, rotationY: 0 },
      }[direction] || { x: 0, y: 42, rotation: 0, rotationX: -7, rotationY: 0 };
      const effectOffset = {
        "fade-in": { x: 0, y: 0, rotation: 0, rotationX: 0, rotationY: 0 },
        "fade-up": { x: 0, y: 42, rotation: 0, rotationX: -7, rotationY: 0 },
        "scale-in": { x: 0, y: 0, rotation: 0, rotationX: 0, rotationY: 0 },
        "slide-left": { x: -56, y: 12, rotation: -1.5, rotationX: 4, rotationY: -8 },
        "slide-right": { x: 56, y: 12, rotation: 1.5, rotationX: 4, rotationY: 8 },
      }[effect];
      const offset = effectOffset || directionOffset;
      const startScale = effect === "scale-in" ? 0.78 : effect === "fade-in" ? 1 : card ? 0.9 : 0.96;
      const delay = (index % 3) * 0.045;
      let played = false;

      gsap.set(element, { opacity: 0 });
      gsap.set(target, {
        x: offset.x,
        y: offset.y,
        rotation: offset.rotation,
        rotationX: offset.rotationX,
        rotationY: offset.rotationY,
        scale: startScale,
        transformPerspective: card ? 900 : 700,
        transformOrigin: "50% 50%",
      });
      spinTargets.forEach((icon) => {
        gsap.set(icon, {
          rotationY: Number(icon.dataset.revealSpin) || 180,
          scale: 0.72,
          transformPerspective: 500,
        });
      });

      const play = () => {
        if (played) return;
        played = true;
        const motion = {
          x: 0,
          y: 0,
          rotation: 0,
          rotationX: 0,
          rotationY: 0,
          scale: 1,
          duration: card ? 1.05 : 0.88,
          delay,
          ease: "power3.out",
          overwrite: true,
          onComplete: () => {
            gsap.set(target, { clearProps: "transform" });
            element.classList.add("is-visible");
          },
        };
        if (target === element) {
          gsap.to(element, { ...motion, opacity: 1 });
        } else {
          gsap.to(element, { opacity: 1, duration: 0.6, delay, ease: "power2.out", overwrite: true });
          gsap.to(target, motion);
        }
        spinTargets.forEach((icon) => gsap.to(icon, {
          rotationY: 0,
          scale: 1,
          duration: 0.9,
          delay: delay + 0.08,
          ease: "back.out(1.7)",
          overwrite: true,
          onComplete: () => gsap.set(icon, { clearProps: "transform" }),
        }));
      };

      ScrollTrigger.create({
        trigger: element,
        start: "top 88%",
        once: true,
        onEnter: play,
      });
    });
  } else {
    observe(revealElements, (element) => element.classList.add("is-visible"));
  }

  // Kinetik matn: bo'laklar pastdan ko'tarilib chiqadi
  const animate = (element, pieces, delay) => {
    if (useGsap && pieces.length) {
      gsap.fromTo(
        pieces,
        { yPercent: 118, opacity: 0 },
        { yPercent: 0, opacity: 1, duration: 1.15, stagger: 0.028, delay, ease: "power4.out" },
      );
      return;
    }
    if (useGsap) {
      gsap.fromTo(element, { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 1, delay, ease: "power3.out" });
      return;
    }
    window.setTimeout(() => element.classList.add("is-visible"), delay * 1000);
  };

  splitPieces.forEach((pieces, element) => {
    element.removeAttribute("data-reveal"); // bo'laklar o'zi animatsiya qilinadi
    if (useGsap) gsap.set(pieces, { yPercent: 118, opacity: 0 }); // sakrab ko'rinmasligi uchun
    if (element.dataset.revealOn === "load") {
      splitReady.push(() => animate(element, pieces, Number(element.dataset.revealDelay || 0)));
      return;
    }
    if (useGsap) {
      ScrollTrigger.create({
        trigger: element,
        start: "top 90%",
        once: true,
        onEnter: () => animate(element, pieces, 0),
      });
      return;
    }
    observe([element], () => animate(element, pieces, 0));
  });

  // Preloader ketgach birga ochiladigan bloklar (hero: tugmalar, izohlar)
  if (onLoad.length) {
    splitReady.push(() => {
      if (useGsap) {
        gsap.fromTo(
          onLoad,
          { opacity: 0, y: 24 },
          { opacity: 1, y: 0, duration: 0.95, stagger: 0.12, ease: "power3.out" },
        );
        return;
      }
      onLoad.forEach((element) => element.classList.add("is-visible"));
    });
  }

  counters();
  return { splitReady };
}

/** Matnni so'z/harf bo'laklariga ajratadi va bo'laklar ro'yxatini qaytaradi. */
function splitElement(element, mode) {
  const source = (element.textContent || "").trim();
  if (!source) return [];
  const words = source.split(/\s+/);
  const pieces = [];
  const fragment = document.createDocumentFragment();

  words.forEach((word, index) => {
    const box = document.createElement("span");
    box.style.display = "inline-block";
    box.style.overflow = "hidden";
    box.style.verticalAlign = "top";
    box.style.padding = "0.14em 0";
    if (mode === "char") {
      [...word].forEach((char) => pieces.push(appendPiece(box, char, "split-char")));
    } else {
      pieces.push(appendPiece(box, word, "split-word"));
    }
    fragment.appendChild(box);
    if (index < words.length - 1) fragment.appendChild(document.createTextNode(" "));
  });

  element.textContent = "";
  element.style.position = "relative";
  element.appendChild(fragment);
  element.dataset.splitDone = "1";
  return pieces;
}

function appendPiece(parent, text, className) {
  const piece = document.createElement("span");
  piece.className = className;
  piece.textContent = text;
  piece.style.display = "inline-block";
  piece.style.willChange = "transform";
  parent.appendChild(piece);
  return piece;
}

/** Bo'laklarga bo'lingan gradient sarlavhada yaxlit gradient ko'rinishini tiklaydi. */
function paintGradient(parent, pieces) {
  if (!pieces.length) return;
  const source = getComputedStyle(parent).backgroundImage;
  if (!source || source === "none") return;

  const apply = () => {
    const width = parent.offsetWidth;
    const height = parent.offsetHeight;
    pieces.forEach((piece) => {
      piece.style.backgroundImage = source;
      piece.style.backgroundRepeat = "no-repeat";
      piece.style.backgroundSize = `${width}px ${height}px`;
      piece.style.backgroundPosition = `${-piece.offsetLeft}px ${-piece.offsetTop}px`;
      piece.style.webkitBackgroundClip = "text";
      piece.style.backgroundClip = "text";
      piece.style.color = "transparent";
    });
  };

  apply();
  let timer = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(apply, 240);
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(apply).catch(() => {});
}

function observe(nodes, callback) {
  const list = [...nodes];
  if (!list.length) return;
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        callback(entry.target);
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -10% 0px", threshold: 0.12 },
  );
  list.forEach((node) => observer.observe(node));
}

/** [data-count="1200"][data-count-suffix="+"] raqamlarini jonli sanaydi. */
function counters() {
  const nodes = [...document.querySelectorAll("[data-count]")];
  if (!nodes.length) return;

  const run = (node) => {
    const target = Number(node.dataset.count) || 0;
    const suffix = node.dataset.countSuffix || "";
    const duration = 1500;
    const started = performance.now();
    const step = (now) => {
      const progress = Math.min((now - started) / duration, 1);
      const eased = 1 - (1 - progress) ** 3;
      node.textContent = `${Math.round(target * eased).toLocaleString("uz-UZ")}${suffix}`;
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  observe(nodes, run);
}
