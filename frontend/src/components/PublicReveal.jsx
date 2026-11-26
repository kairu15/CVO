import { useEffect, useRef, useState } from "react";

/**
 * Subtle scroll reveal for public sections.
 *
 * One IntersectionObserver per element, disconnected as soon as it has fired,
 * so a long page does not accumulate observers. With no IntersectionObserver
 * (older browsers, jsdom) the content is shown immediately — the reveal is
 * decoration, never a prerequisite for reading. Reduced-motion is handled in
 * CSS (`.public-reveal`), so the element is still visible if animations are off.
 */
export function PublicReveal({ as: Tag = "div", className = "", delay = 0, children }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={`public-reveal ${shown ? "is-visible" : ""} ${className}`.trim()}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
