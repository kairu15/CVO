/**
 * Static site copy for the public-facing pages.
 *
 * Everything a CVO administrator has to change before launch lives here so no
 * component needs editing.
 *
 * The CONTACT values are FALLBACKS, not the source of truth: an administrator
 * edits the office contact profile in System Settings, it is stored in the
 * `settings` table, and the public pages read it back through
 * `useSiteConfig` (GET /api/v1/site). These literals are what renders before
 * that request lands, and what renders if it fails — so a page is never blank
 * and never wrong, just possibly a moment behind. Replace them with the real
 * office numbers before launch so the fallback is also correct.
 */

/**
 * The shipped contact values, keyed exactly as the API returns them.
 *
 * Kept in one object so the site object below, the shared password-reset
 * policy and the `useSiteConfig` fallback cannot drift apart.
 */
export const officeContactFallback = {
  office_email: "cvo@example.gov.ph",
  office_phone: "(035) 000-0000",
  office_hours: "Monday to Friday, 8:00 AM – 5:00 PM",
  office_address:
    "City Veterinary Office, City Hall Compound, Bayawan City, Negros Oriental 6221",
};

// Defined once so every surface that mentions them (the site object below,
// the shared password-reset policy) stays in sync.
const CONTACT_EMAIL = officeContactFallback.office_email;
const CONTACT_PHONE = officeContactFallback.office_phone;

export const site = {
  systemName: "Geo-Tagging of Livestock and Poultry Dispersal and Re-Dispersal",
  shortName: "CVO Geo-Tagging",
  office: "City Veterinary Office",
  city: "Bayawan City",
  province: "Negros Oriental",
  address: officeContactFallback.office_address,
  email: CONTACT_EMAIL,
  phone: CONTACT_PHONE,
  hours: officeContactFallback.office_hours,
  tagline:
    "Tracking every animal the City Veterinary Office disperses — from the first geo-tag to every re-dispersal — so livestock and poultry support reaches the right farmer.",
  social: [
    { label: "Facebook", href: "#", icon: "facebook" },
    { label: "Official website", href: "#", icon: "globe" },
    { label: "Email the office", href: "#", icon: "mail" },
  ],

  /**
   * The password-reset policy, shared verbatim by the sign-in form's
   * "Forgot password?" note and the farmer Support page — defined once so
   * the two screens cannot drift apart.
   */
  passwordResetPolicy: `Password resets are handled by the CVO administrator for security reasons. Contact the office at ${CONTACT_EMAIL} or ${CONTACT_PHONE} to request a new password.`,
};

/** Top navigation for the landing page — all anchors into page sections. */
export const navLinks = [
  { label: "Home", href: "#home" },
  { label: "About", href: "#about" },
  { label: "Services", href: "#services" },
  { label: "Contact", href: "#contact" },
];

/** The four capability highlights in the About/Services section. */
export const features = [
  {
    icon: "map-pin",
    title: "Geo-Tagging",
    body: "Every dispersed animal is pinned to a location, so the office knows exactly where each head of livestock or batch of poultry ended up.",
  },
  {
    icon: "medical-cross",
    title: "Health Monitoring",
    body: "Veterinary staff log health records and vaccination schedules against the same tag, keeping animal health history in one place.",
  },
  {
    icon: "truck",
    title: "Dispersal Tracking",
    body: "Record each dispersal batch, the beneficiary who received it, and the re-dispersal of offspring to the next farmer in line.",
  },
  {
    icon: "chart",
    title: "Reporting",
    body: "Generate consolidated reports per barangay, species or program cycle to support planning and fund utilisation reviews.",
  },
];
