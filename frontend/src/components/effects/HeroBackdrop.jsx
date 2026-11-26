import { Suspense, lazy, useEffect, useState } from "react";

// MicroSlats pulls in `ogl` and a set of GLSL programs. Loading it on demand
// keeps that weight out of the landing page's initial bundle and means the
// effect is never instantiated on a device that cannot render it.
const MicroSlats = lazy(() => import("./MicroSlats"));

/** WebGL2 probe — the component itself requires a WebGL2 context. */
function supportsWebGl2() {
  if (typeof document === "undefined") return false;
  // jsdom (the test environment) defines canvas.getContext only as a stub that
  // logs "not implemented"; the missing global is the reliable signal.
  if (typeof window === "undefined" || !("WebGL2RenderingContext" in window)) {
    return false;
  }
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/**
 * The hero's animated backdrop.
 *
 * The visual always has a static navy/teal gradient underneath, so the hero
 * is complete before (and without) WebGL. MicroSlats is layered on top only
 * when:
 *   - the browser has WebGL2,
 *   - the visitor has not asked for reduced motion.
 *
 * Phones and touch devices get a calmer configuration (larger slats, slower
 * movement, no cursor fluid) to protect frame rate and battery. The wrapper is
 * pointer-events-none, so it can never intercept a button or link; MicroSlats
 * listens on `window`, so its cursor interaction still works.
 */
export function HeroBackdrop({ className = "", fixed = false }) {
  const [mode, setMode] = useState("static");

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reducedMotion || !supportsWebGl2()) return undefined;

    // Defer the lazy chunk by a frame so the hero copy paints first.
    const frame = window.requestAnimationFrame(() => {
      const narrow = window.matchMedia?.("(max-width: 767px)").matches ?? false;
      const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
      setMode(narrow || coarse ? "calm" : "full");
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none ${
        fixed ? "fixed" : "absolute"
      } inset-0 overflow-hidden ${className}`}
      data-testid="hero-backdrop"
      data-mode={mode}
    >
      {/* Static fallback: always present, so no-WebGL and reduced-motion
          visitors see a finished hero rather than a flat block. */}
      <div className="absolute inset-0 bg-cvo-navy" />
      <div className="absolute inset-0 bg-[radial-gradient(120%_110%_at_12%_0%,#285f6b_0%,#133336_42%,#0b1f29_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(16,42,54,0.10)_0%,rgba(11,31,41,0.72)_100%)]" />

      {mode !== "static" && (
        <Suspense fallback={null}>
          <MicroSlats
            className="absolute inset-0 h-full w-full"
            preset="tide"
            color="#367D8A"
            glintColor="#D9F3F2"
            backgroundColor="#102A36"
            slatWidth={mode === "calm" ? 14 : 10}
            slatHeight={mode === "calm" ? 30 : 25}
            gap={mode === "calm" ? 4 : 3}
            roundness={0.75}
            interactive={mode === "full"}
            cursorStrength={0.55}
            cursorSize={38}
            swirl={0.25}
            trail={1.4}
            lean={0.12}
            intro
            introDuration={1.8}
          />
        </Suspense>
      )}
    </div>
  );
}
