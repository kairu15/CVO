/**
 * Static site copy for the public-facing pages.
 *
 * Everything a CVO administrator has to change before launch lives here so no
 * component needs editing. The contact details below are placeholders — swap
 * them for the real office numbers.
 */

// Defined once so every surface that mentions them (the site object below,
// the shared password-reset policy) stays in sync.
const CONTACT_EMAIL = "cvo@example.gov.ph";
const CONTACT_PHONE = "(035) 000-0000";

export const site = {
  systemName: "Geo-Tagging of Livestock and Poultry Dispersal and Re-Dispersal",
  shortName: "CVO Geo-Tagging",
  office: "City Veterinary Office",
  city: "Bayawan City",
  province: "Negros Oriental",
  address: "City Veterinary Office, City Hall Compound, Bayawan City, Negros Oriental 6221",
  email: CONTACT_EMAIL,
  phone: CONTACT_PHONE,
  hours: "Monday to Friday, 8:00 AM – 5:00 PM",
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
