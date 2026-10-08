/**
 * Silliq scroll (Lenis) va unga bog'langan scroll-animatsiyalar.
 *
 *  - Lenis → sahifa fizikasi; GSAP ticker bilan birlashtiriladi (frame-perfect sync)
 *  - ScrollTrigger → parallax qatlamlar
 *  - GSAP bo'lmasa: oddiy requestAnimationFrame parallax zaxira rejimi
 *  - Silliq anchor o'tishlar va navigatsiyaning yashirinish/kо'rinish holati
 */

export function init({ reduced }) {
  const gsap = window.gsap;
  const ScrollTrigger = window.ScrollTrigger;
  if (gsap && ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

  const lenis = typeof window.Lenis === "function"
    ? new window.Lenis({
        duration: 1.15,
        lerp: reduced ? 1 : 0.09,
        wheelMultiplier: 1,
        touchMultiplier: 1.5,
        smoothWheel: !reduced,
        autoRaf: false,
      })
    : null;

  if (lenis) {
    lenis.on("scroll", () => ScrollTrigger && ScrollTrigger.update());
    if (gsap) {
      gsap.ticker.add((time) => lenis.raf(time * 1000));
      gsap.ticker.lagSmoothing(0);
    } else {
      const loop = (time) => {
        lenis.raf(time);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
  }

  const scrollTo = (target) => {
    const element = typeof target === "string" ? document.querySelector(target) : target;
    if (!element) return;
    if (lenis) lenis.scrollTo(element, { offset: -76, duration: 1.35 });
    else element.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  };

  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      const id = link.getAttribute("href");
      if (!id || id === "#") return;
      event.preventDefault();
      scrollTo(id);
    });
  });

  // Navigatsiya: pastga scroll bo'lganda yashirinadi, tepaga qaytganda chiqadi
  const nav = document.querySelector("[data-nav]");
  let previous = 0;
  const onScroll = (scroll) => {
    if (!nav) return;
    const current = typeof scroll === "number" ? scroll : window.scrollY;
    nav.classList.toggle("is-scrolled", current > 24);
    nav.classList.toggle("is-hidden", current > previous && current > 320);
    previous = current;
  };

  if (lenis) lenis.on("scroll", ({ scroll }) => onScroll(scroll));
  window.addEventListener("scroll", () => onScroll(window.scrollY), { passive: true });
  onScroll(0);

  // Faol bo'limni belgilash
  const sections = [...document.querySelectorAll("section[id]")];
  const links = [...document.querySelectorAll("[data-nav] a[href^='#']")];
  if (sections.length && links.length && !reduced) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          links.forEach((link) => {
            link.classList.toggle("is-active", link.getAttribute("href") === `#${entry.target.id}`);
          });
        });
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    sections.forEach((section) => observer.observe(section));
  }

  // Parallax qatlamlar
  const layers = [...document.querySelectorAll("[data-parallax]")];
  if (layers.length) {
    if (gsap && ScrollTrigger && !reduced) {
      layers.forEach((layer) => {
        const speed = Number.parseFloat(layer.dataset.parallax) || 0.18;
        gsap.fromTo(
          layer,
          { yPercent: speed * 45 },
          {
            yPercent: -speed * 45,
            ease: "none",
            scrollTrigger: { trigger: layer, start: "top bottom", end: "bottom top", scrub: true },
          },
        );
      });
    } else if (!reduced) {
      const update = () => {
        const midpoint = window.innerHeight / 2;
        layers.forEach((layer) => {
          const rect = layer.getBoundingClientRect();
          const speed = Number.parseFloat(layer.dataset.parallax) || 0.18;
          const shift = (rect.top + rect.height / 2 - midpoint) * speed * -0.35;
          layer.style.transform = `translate3d(0, ${shift.toFixed(2)}px, 0)`;
        });
      };
      window.addEventListener("scroll", () => requestAnimationFrame(update), { passive: true });
      update();
    }
  }

  document.documentElement.classList.add("has-scroll");
  return { lenis, scrollTo, gsap, ScrollTrigger };
}
