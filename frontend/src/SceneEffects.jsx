import { useEffect } from "react";

export default function SceneEffects() {
  useEffect(() => {
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const cursorRoot = document.createElement("div");
    cursorRoot.className = "app-custom-cursor";
    cursorRoot.setAttribute("aria-hidden", "true");
    const cursorDot = document.createElement("span");
    cursorDot.className = "app-custom-cursor-dot";
    const cursorRing = document.createElement("span");
    cursorRing.className = "app-custom-cursor-ring";
    cursorRoot.append(cursorDot, cursorRing);
    document.body.appendChild(cursorRoot);

    let enabled = false;
    let cursorEnabled = false;
    let visible = false;
    let cursorVisible = false;
    let frame = 0;
    let hovered = null;
    let magnet = null;
    let tilted = null;
    const magnetPosition = { x: 0, y: 0 };
    const magnetTarget = { x: 0, y: 0 };
    const cursorPosition = { x: 0, y: 0, ringX: 0, ringY: 0 };
    const magneticElements = new Set();
    const magnetSelector = ".suggestion-card";
    const interactiveSelector = "button:not(:disabled), a[href], [role='button']";
    const effectElements = new Set();

    const moveMagnet = (element, event) => {
      if (magnet && magnet !== element) resetMagnet();
      if (!element) {
        magnet = null;
        magnetTarget.x = 0;
        magnetTarget.y = 0;
        resetTilt();
        return;
      }
      if (element !== magnet) {
        magnetPosition.x = 0;
        magnetPosition.y = 0;
      }
      magnet = element;
      element.classList.add("cursor-magnetic");
      magneticElements.add(element);
      const bounds = element.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const dx = event.clientX - (bounds.left + bounds.width / 2);
      const dy = event.clientY - (bounds.top + bounds.height / 2);
      const distance = Math.hypot(dx, dy);
      const radius = Math.max(bounds.width, bounds.height) * 1.15;
      const strength = distance < radius ? 1 - distance / radius : 0;
      magnetTarget.x = Math.max(-4, Math.min(4, dx * 0.075 * strength));
      magnetTarget.y = Math.max(-4, Math.min(4, dy * 0.075 * strength));
      const x = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
      const y = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
      element.style.setProperty("--cursor-x", `${x}px`);
      element.style.setProperty("--cursor-y", `${y}px`);

      if (tilted !== element) {
        resetTilt();
        tilted = element;
        effectElements.add(element);
        element.classList.add("cursor-3d");
      }
      const nx = Math.max(-1, Math.min(1, dx / (bounds.width / 2)));
      const ny = Math.max(-1, Math.min(1, dy / (bounds.height / 2)));
      const maxTilt = element.matches(".suggestion-card, .suggestion-more, .account-card") ? 8 : 3;
      const edge = Math.min(1, Math.hypot(nx, ny) * 1.15);
      element.style.setProperty("--tilt-x", `${(-ny * maxTilt * edge).toFixed(2)}deg`);
      element.style.setProperty("--tilt-y", `${(nx * maxTilt * edge).toFixed(2)}deg`);
    };

    function resetMagnet() {
      if (magnet) {
        magnet.classList.remove("cursor-magnetic");
        magnet.style.removeProperty("--cursor-x");
        magnet.style.removeProperty("--cursor-y");
        magnet.style.removeProperty("--magnet-x");
        magnet.style.removeProperty("--magnet-y");
        magneticElements.delete(magnet);
      }
      magnet = null;
      magnetTarget.x = 0;
      magnetTarget.y = 0;
    }

    function resetTilt() {
      if (!tilted) return;
      tilted.classList.remove("cursor-3d");
      tilted.style.removeProperty("--tilt-x");
      tilted.style.removeProperty("--tilt-y");
      tilted.style.removeProperty("--cursor-x");
      tilted.style.removeProperty("--cursor-y");
      effectElements.delete(tilted);
      tilted = null;
    }

    const stop = () => {
      if (!frame) return;
      cancelAnimationFrame(frame);
      frame = 0;
    };

    const render = () => {
      magnetPosition.x += (magnetTarget.x - magnetPosition.x) * 0.24;
      magnetPosition.y += (magnetTarget.y - magnetPosition.y) * 0.24;
      if (magnet) {
        magnet.style.setProperty("--magnet-x", `${magnetPosition.x.toFixed(2)}px`);
        magnet.style.setProperty("--magnet-y", `${magnetPosition.y.toFixed(2)}px`);
      }
      const settled = Math.abs(magnetTarget.x - magnetPosition.x) < 0.1
        && Math.abs(magnetTarget.y - magnetPosition.y) < 0.1;
      const cursorSettled = Math.abs(cursorPosition.x - cursorPosition.ringX) < 0.18
        && Math.abs(cursorPosition.y - cursorPosition.ringY) < 0.18;
      if (cursorVisible && !reducedMotion.matches) {
        cursorPosition.ringX += (cursorPosition.x - cursorPosition.ringX) * 0.42;
        cursorPosition.ringY += (cursorPosition.y - cursorPosition.ringY) * 0.42;
        cursorRing.style.transform =
          `translate3d(${cursorPosition.ringX.toFixed(2)}px,${cursorPosition.ringY.toFixed(2)}px,0) translate(-50%,-50%)`;
      }
      frame = visible && (!settled || (cursorVisible && !cursorSettled && !reducedMotion.matches))
        ? requestAnimationFrame(render)
        : 0;
    };

    const scheduleRender = () => {
      if (!frame && visible) frame = requestAnimationFrame(render);
    };

    const pointerMove = (event) => {
      if (!cursorEnabled || (event.pointerType && event.pointerType !== "mouse")) return;
      visible = true;
      const targetElement = event.target instanceof Element ? event.target : null;
      const interactiveTarget = targetElement?.closest(interactiveSelector) || null;
      const textTarget = !interactiveTarget && Boolean(targetElement?.closest("input,textarea,select,[contenteditable='true'],p,h1,h2,h3,h4,blockquote,pre,code,label"));
      cursorVisible = !textTarget;
      cursorRoot.classList.toggle("is-text-entry", textTarget);
      cursorRoot.classList.toggle("is-interactive", Boolean(interactiveTarget));
      if (cursorVisible) {
        cursorRoot.classList.add("is-visible");
        cursorPosition.x = event.clientX;
        cursorPosition.y = event.clientY;
        cursorDot.style.transform = `translate3d(${event.clientX}px,${event.clientY}px,0) translate(-50%,-50%)`;
        if (reducedMotion.matches) {
          cursorPosition.ringX = event.clientX;
          cursorPosition.ringY = event.clientY;
          cursorRing.style.transform = cursorDot.style.transform;
        }
      } else {
        cursorRoot.classList.remove("is-visible");
      }
      if (!enabled) {
        hovered?.removeAttribute("data-cursor-hover");
        hovered = null;
        resetMagnet();
        resetTilt();
        scheduleRender();
        return;
      }
      const target = interactiveTarget;
      if (hovered !== target) {
        hovered?.removeAttribute("data-cursor-hover");
        hovered = target;
        if (target) target.dataset.cursorHover = "true";
      }
      const magneticTarget = event.target instanceof Element
        ? event.target.closest(magnetSelector)
        : null;
      moveMagnet(magneticTarget, event);
      scheduleRender();
    };

    const pointerLeave = (event) => {
      if (event?.relatedTarget instanceof Node) return;
      visible = false;
      hovered?.removeAttribute("data-cursor-hover");
      hovered = null;
      document.querySelectorAll("[data-cursor-hover]").forEach((element) => {
        element.removeAttribute("data-cursor-hover");
      });
      resetMagnet();
      resetTilt();
      cursorVisible = false;
      cursorRoot.classList.remove("is-visible", "is-interactive", "is-text-entry");
    };

    const onVisibilityChange = () => {
      if (!document.hidden) scheduleRender();
    };

    const syncMotion = () => {
      cursorEnabled = finePointer.matches;
      enabled = finePointer.matches && !reducedMotion.matches;
      if (!cursorEnabled) {
        pointerLeave();
        stop();
      } else if (!enabled) {
        resetMagnet();
        resetTilt();
      }
    };

    window.addEventListener("pointermove", pointerMove, { passive: true });
    window.addEventListener("pointerout", pointerLeave);
    window.addEventListener("blur", pointerLeave);
    document.addEventListener("visibilitychange", onVisibilityChange);
    finePointer.addEventListener("change", syncMotion);
    reducedMotion.addEventListener("change", syncMotion);
    syncMotion();
    return () => {
      stop();
      window.removeEventListener("pointermove", pointerMove);
      window.removeEventListener("pointerout", pointerLeave);
      window.removeEventListener("blur", pointerLeave);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      finePointer.removeEventListener("change", syncMotion);
      reducedMotion.removeEventListener("change", syncMotion);
      document.querySelectorAll("[data-cursor-hover]").forEach((element) => {
        element.removeAttribute("data-cursor-hover");
      });
      resetMagnet();
      resetTilt();
      magneticElements.forEach((element) => {
        element.classList.remove("cursor-magnetic");
        element.style.removeProperty("--cursor-x");
        element.style.removeProperty("--cursor-y");
        element.style.removeProperty("--magnet-x");
        element.style.removeProperty("--magnet-y");
      });
      effectElements.forEach((element) => {
        element.classList.remove("cursor-3d");
        element.style.removeProperty("--tilt-x");
        element.style.removeProperty("--tilt-y");
      });
      cursorRoot.remove();
    };
  }, []);

  return null;
}
