import { useEffect, useRef } from "react";

export default function SceneEffects() {
  const cursorRing = useRef(null);

  useEffect(() => {
    const ring = cursorRing.current;
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!ring) return undefined;

    let active = false;
    const pointerMove = (event) => {
      if (!active) return;
      ring.style.transform = `translate3d(${event.clientX}px,${event.clientY}px,0) translate(-50%,-50%)`;
      ring.dataset.visible = "true";
      const target = event.target instanceof Element
        ? event.target.closest("button:not(:disabled), a[href], [role='button']")
        : null;
      ring.dataset.hover = String(Boolean(target));
    };
    const pointerLeave = () => {
      ring.dataset.visible = "false";
    };
    const syncMotion = () => {
      active = finePointer.matches && !reducedMotion.matches;
      ring.dataset.enabled = String(active);
      if (!active) pointerLeave();
    };

    window.addEventListener("pointermove", pointerMove, { passive: true });
    window.addEventListener("pointerleave", pointerLeave);
    window.addEventListener("blur", pointerLeave);
    finePointer.addEventListener("change", syncMotion);
    reducedMotion.addEventListener("change", syncMotion);
    syncMotion();
    return () => {
      window.removeEventListener("pointermove", pointerMove);
      window.removeEventListener("pointerleave", pointerLeave);
      window.removeEventListener("blur", pointerLeave);
      finePointer.removeEventListener("change", syncMotion);
      reducedMotion.removeEventListener("change", syncMotion);
    };
  }, []);

  return <span className="smooth-cursor-ring" ref={cursorRing} aria-hidden="true" />;
}
