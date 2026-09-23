/**
 * Inline SVG icon set.
 *
 * Hand-rolled on purpose: the project has no icon dependency, and pulling one
 * in for a dozen glyphs is not worth the bundle. Every icon is drawn on a
 * 24x24 grid with a 1.75 stroke so they sit consistently next to text.
 */

const ICONS = {
  /* Navigation & chrome */
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.8" />
      <path d="m16.2 16.2 4.3 4.3" />
    </>
  ),
  bell: (
    <>
      <path d="M18 9.5a6 6 0 1 0-12 0c0 4.6-1.8 5.9-1.8 5.9h15.6S18 14.1 18 9.5Z" />
      <path d="M10.3 19a2 2 0 0 0 3.4 0" />
    </>
  ),
  "chevron-down": <path d="m6 9.5 6 6 6-6" />,
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.8" />
    </>
  ),
  "arrow-right": <path d="M4.5 12h14M13 6.5l5.5 5.5-5.5 5.5" />,
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  logout: (
    <>
      <path d="M9.5 21H6a2.2 2.2 0 0 1-2.2-2.2V5.2A2.2 2.2 0 0 1 6 3h3.5" />
      <path d="m16 16.5 4.5-4.5L16 7.5" />
      <path d="M20.5 12h-11" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.8" />
      <path d="M4.8 20.5a7.2 7.2 0 0 1 14.4 0" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.4" />
      <path d="M8.2 10.5V7.8a3.8 3.8 0 0 1 7.6 0v2.7" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  "eye-off": (
    <>
      <path d="m4 4 16 16" />
      <path d="M9.9 5.9A9.8 9.8 0 0 1 12 5.8c6 0 9.5 6.2 9.5 6.2a17.4 17.4 0 0 1-3 3.7" />
      <path d="M6.4 7.7A17.4 17.4 0 0 0 2.5 12S6 18.2 12 18.2a9.7 9.7 0 0 0 3.7-.7" />
      <path d="M10.1 10.3a2.8 2.8 0 0 0 3.7 3.9" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.8v5M12 16.2h.01" />
    </>
  ),
  "alert-circle": (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.2v5.6M12 16.4h.01" />
    </>
  ),
  "locate-fixed": (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22" />
    </>
  ),

  /* Agriculture, livestock & veterinary */
  sprout: (
    <>
      <path d="M12 21v-9" />
      <path d="M12 12c0-4.4 3.6-8 8-8 0 4.4-3.6 8-8 8Z" />
      <path d="M12 15.5c-3.9 0-7-3.1-7-7 3.9 0 7 3.1 7 7Z" />
    </>
  ),
  livestock: (
    <>
      <path d="M4.8 4.2c0 2.4.9 3.9 2.2 4.7" />
      <path d="M19.2 4.2c0 2.4-.9 3.9-2.2 4.7" />
      <path d="M12 6.2c-3.9 0-6.6 2.7-6.6 6.3 0 4 2.9 7.8 6.6 7.8s6.6-3.8 6.6-7.8c0-3.6-2.7-6.3-6.6-6.3Z" />
      <ellipse cx="9.6" cy="13" rx="1" ry="1.4" />
      <ellipse cx="14.4" cy="13" rx="1" ry="1.4" />
    </>
  ),
  "medical-cross": (
    <>
      <rect x="9.6" y="3" width="4.8" height="18" rx="1.6" />
      <rect x="3" y="9.6" width="18" height="4.8" rx="1.6" />
    </>
  ),
  activity: <path d="M3 12.5h3.5l2.2-5.6 3.6 10.6 2.4-7 1.6 2h4.7" />,
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.4" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),

  /* Location & dispersal */
  "map-pin": (
    <>
      <path d="M12 21.5s6.8-5.6 6.8-11a6.8 6.8 0 1 0-13.6 0c0 5.4 6.8 11 6.8 11Z" />
      <circle cx="12" cy="10.2" r="2.6" />
    </>
  ),
  map: (
    <>
      <path d="M9 4 3.5 6v13.5L9 17.5l6 2 5.5-2V4l-5.5 2Z" />
      <path d="M9 4v13.5M15 6v13.5" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="18" r="2.8" />
      <circle cx="18" cy="6" r="2.8" />
      <path d="M8.8 18h5.4a3.8 3.8 0 0 0 3.8-3.8V8.8" />
    </>
  ),
  truck: (
    <>
      <rect x="2.5" y="7.5" width="10.2" height="9" rx="1.2" />
      <path d="M12.7 10.5h4.3l3 3v3h-7.3Z" />
      <circle cx="7" cy="18.4" r="1.8" />
      <circle cx="16.5" cy="18.4" r="1.8" />
    </>
  ),
  refresh: (
    <>
      <path d="M3.8 12a8.2 8.2 0 0 1 13.8-6" />
      <path d="M17.6 2.8v3.6H14" />
      <path d="M20.2 12a8.2 8.2 0 0 1-13.8 6" />
      <path d="M6.4 21.2v-3.6H10" />
    </>
  ),

  /* Records & administration */
  chart: (
    <>
      <path d="M3.5 20.5h17" />
      <rect x="5" y="11" width="3.4" height="6.5" rx="1" />
      <rect x="10.3" y="6.5" width="3.4" height="11" rx="1" />
      <rect x="15.6" y="9" width="3.4" height="8.5" rx="1" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.4" />
      <path d="M2.8 20.2a6.2 6.2 0 0 1 12.4 0" />
      <path d="M16.2 5a3.4 3.4 0 0 1 0 6.6" />
      <path d="M17.6 14.4a6.2 6.2 0 0 1 3.6 5.8" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.2 19 6v5.8c0 4.3-2.9 7.7-7 9-4.1-1.3-7-4.7-7-9V6Z" />
      <path d="m9.2 11.8 2 2 3.6-3.8" />
    </>
  ),
  sliders: (
    <>
      <path d="M3.5 7h3.3M11 7h9.5" />
      <circle cx="9" cy="7" r="2.2" />
      <path d="M3.5 12h7.3M18.5 12h2.5" />
      <circle cx="15" cy="12" r="2.2" />
      <path d="M3.5 17h1.3M11 17h9.5" />
      <circle cx="8" cy="17" r="2.2" />
    </>
  ),
  clipboard: (
    <>
      <rect x="5" y="4.5" width="14" height="16.5" rx="2.2" />
      <path d="M9 4.5V3.8A1.3 1.3 0 0 1 10.3 2.5h3.4A1.3 1.3 0 0 1 15 3.8v.7" />
      <path d="M8.5 11h7M8.5 15h4.5" />
    </>
  ),
  "clipboard-check": (
    <>
      <rect x="5" y="4.5" width="14" height="16.5" rx="2.2" />
      <path d="M9 4.5V3.8A1.3 1.3 0 0 1 10.3 2.5h3.4A1.3 1.3 0 0 1 15 3.8v.7" />
      <path d="m8.8 13.2 2.2 2.2 4.2-4.4" />
    </>
  ),
  "file-text": (
    <>
      <path d="M14 3H7.5A1.5 1.5 0 0 0 6 4.5v15A1.5 1.5 0 0 0 7.5 21h9a1.5 1.5 0 0 0 1.5-1.5V7Z" />
      <path d="M14 3v4h4" />
      <path d="M9 12.5h6M9 16.5h4" />
    </>
  ),
  "life-buoy": (
    <>
      <circle cx="12" cy="12" r="8.8" />
      <circle cx="12" cy="12" r="3.6" />
      <path d="m5.8 5.8 3.6 3.6M14.6 14.6l3.6 3.6M18.2 5.8l-3.6 3.6M9.4 14.6l-3.6 3.6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.8" />
      <path d="M12 7.2V12l3.4 2" />
    </>
  ),

  /* Contact & social */
  mail: (
    <>
      <rect x="3" y="5.2" width="18" height="13.6" rx="2.4" />
      <path d="m3.8 7 8.2 6 8.2-6" />
    </>
  ),
  phone: (
    <path d="M6.6 3.2h3l1.5 3.9-2 1.4a12.2 12.2 0 0 0 6.4 6.4l1.4-2 3.9 1.5v3a2 2 0 0 1-2.2 2A17.2 17.2 0 0 1 4.6 5.4a2 2 0 0 1 2-2.2Z" />
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.8" />
      <path d="M3.4 12h17.2" />
      <path d="M12 3.2a14 14 0 0 1 0 17.6 14 14 0 0 1 0-17.6Z" />
    </>
  ),
  facebook: (
    <path d="M14.8 8.6h2.4V5.4h-2.4a4.4 4.4 0 0 0-4.4 4.4v2H8v3.2h2.4V21h3.2v-6h2.5l.5-3.2h-3v-1.9a1.3 1.3 0 0 1 1.2-1.3Z" />
  ),
};

/**
 * @param {object} props
 * @param {keyof typeof ICONS} props.name
 * @param {string} [props.className]
 * @param {number} [props.strokeWidth]
 */
export function Icon({ name, className = "h-5 w-5", strokeWidth = 1.75 }) {
  const glyph = ICONS[name];
  if (!glyph) return null;

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {glyph}
    </svg>
  );
}
