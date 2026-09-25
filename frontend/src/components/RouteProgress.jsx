import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

/**
 * Thin animated progress bar fixed to the top of the viewport, shown during
 * route transitions (including lazy chunk loads, which suspend right after
 * the location changes). Custom implementation — no extra dependency.
 *
 * Lifecycle per navigation: the bar appears and creeps toward 90% (slow CSS
 * transition), then completes to 100% and fades out once the new page has
 * had time to paint. A rAF gap between mount and creep keeps the very first
 * frame at 0 width so the creep actually animates instead of jumping.
 */
export function RouteProgress() {
  const { pathname } = useLocation();
  const [phase, setPhase] = useState("idle"); // idle | running | done
  const [creeping, setCreeping] = useState(false);

  useEffect(() => {
    setPhase("running");
    setCreeping(false);

    const raf = requestAnimationFrame(() => setCreeping(true));
    const finish = setTimeout(() => setPhase("done"), 450);
    const reset = setTimeout(() => setPhase("idle"), 750);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(finish);
      clearTimeout(reset);
    };
  }, [pathname]);

  if (phase === "idle") return null;

  return (
    <div
      className="fixed inset-x-0 top-0 z-[60] h-[3px] pointer-events-none"
      role="progressbar"
      aria-label="Page loading"
    >
      <div
        className={`h-full bg-brand-600 shadow-[0_0_8px_var(--color-brand-400)] transition-all ease-out ${
          phase === "running"
            ? creeping
              ? "w-[90%] duration-[2000ms]"
              : "w-0 duration-0"
            : "w-full opacity-0 duration-200"
        }`}
      />
    </div>
  );
}
