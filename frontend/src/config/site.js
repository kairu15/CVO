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
  systemName:
    "Livestock and Poultry Dispersal and Redispersal Management System with Geotagging for Veterinary Office of the Department of Agriculture",
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
   * "Forgot password?" note — defined in one place so no screen drifts.
   */
  passwordResetPolicy: `Password resets are handled by the CVO administrator for security reasons. Contact the office at ${CONTACT_EMAIL} or ${CONTACT_PHONE} to request a new password.`,
};

/**
 * Top navigation for the public pages — one list shared by the header and
 * footer. Section links are ROUTE links (`/#about`), so they work from any
 * public page: arriving at `/#about` from `/transparency` lands on the
 * landing page and scrolls to the section. "Contact" is the footer.
 */
export const navLinks = [
  { label: "Home", href: "/#home" },
  { label: "About", href: "/#about" },
  { label: "Services", href: "/#services" },
  { label: "Contact", href: "/#contact" },
];

/** True when a nav/social link is a real destination (not a placeholder). */
export const isRealLink = (href) =>
  Boolean(href) && href !== "#";

/**
 * The office's citizen-facing services, rendered in the landing page's
 * Services section ahead of the system-capability cards.
 *
 * TEMPLATE COPY, exactly like the contact fallbacks above: these describe the
 * services a Philippine city veterinary office typically offers so the
 * structure is real, but every requirement, procedure, fee, processing time
 * and scope line MUST be verified and corrected with the office before
 * launch. Nothing here is fetched from the database — services are stable
 * copy, not records.
 */
export const publicServices = [
  {
    icon: "medical-cross",
    title: "Anti-Rabies Vaccination",
    body: "Free anti-rabies vaccination for dogs and cats, at the office and during scheduled barangay outreach drives.",
    requirements: [
      "Dog or cat at least 3 months old",
      "Previous vaccination record, if available",
    ],
    steps: [
      "Bring your pet to the office or to the scheduled barangay outreach",
      "The pet is registered and vaccinated on site",
      "Keep the vaccination card — boosters are due yearly",
    ],
    fee: "Free of charge",
    processing: "About 15–30 minutes per animal; no appointment needed at the office.",
  },
  {
    icon: "activity",
    title: "Animal Health Consultation",
    body: "Walk-in consultation, treatment and follow-up care for livestock, poultry and companion animals.",
    requirements: [
      "The animal itself, or photos of its condition for large livestock",
      "Any prior treatment or medication records",
    ],
    steps: [
      "Walk in during office hours or call ahead for large animals",
      "A veterinary aide or veterinarian examines the animal",
      "Treatment, medication and a follow-up schedule are given",
    ],
    fee: "Consultation free; medicines may be charged at cost",
    processing: "Same day for walk-ins; large-animal house calls by schedule.",
  },
  {
    icon: "livestock",
    title: "Livestock & Poultry Dispersal Application",
    body: "Apply to become a beneficiary of the city's livestock and poultry dispersal program.",
    requirements: [
      "Resident of Bayawan City with barangay certification",
      "Suitable space to keep the animal",
      "Attendance at the program orientation",
    ],
    steps: [
      "File your intent to avail at the City Veterinary Office",
      "Household and site validation by field staff",
      "On approval, the animal is released and geo-tagged to your location",
    ],
    fee: "No fee; dispersed animals follow the program's re-dispersal policy",
    processing: "Screening and validation typically within 2–4 weeks of filing.",
  },
  {
    icon: "shield",
    title: "Deworming & Vitamin Supplementation",
    body: "Routine deworming and vitamin supplementation for livestock and poultry, often bundled with barangay outreach visits.",
    requirements: [
      "The animal, at the office or the outreach site",
    ],
    steps: [
      "Watch the office's announcements for outreach schedules",
      "Bring the animal to the schedule or walk in during office hours",
      "The dose is recorded against the animal's record",
    ],
    fee: "Free of charge",
    processing: "Minutes per animal during outreach schedules.",
  },
  {
    icon: "file-text",
    title: "Veterinary Health Certificate",
    body: "Health certificates for animals being transported, sold or shipped out of the city.",
    requirements: [
      "The animal for inspection",
      "Valid ID of the owner or shipper",
      "Destination and transport details",
    ],
    steps: [
      "Bring the animal to the office for inspection",
      "The issuing veterinarian examines and certifies the animal",
      "Pay the corresponding fee at the city treasury",
    ],
    fee: "Per the city's schedule of fees",
    processing: "Issued the same day after inspection.",
  },
  {
    icon: "locate-fixed",
    title: "Stray Animal Control & Impounding",
    body: "Response to reports of stray animals, and the impounding, claim and adoption procedure for captured animals.",
    requirements: [
      "Location of the stray animal when reporting",
      "Proof of ownership when claiming an impounded animal",
    ],
    steps: [
      "Report strays to the office or your barangay",
      "The pound team captures and impounds the animal",
      "Owners claim impounded animals with the required fee",
    ],
    fee: "Impounding and claim fees per city ordinance",
    processing: "Response within the day, subject to team availability; claims during office hours.",
  },
];

/**
 * Office-level copy for the About section: mandate, vision, mission, goals,
 * responsibilities and structure.
 *
 * TEMPLATE COPY — replace with the office's own official statements before
 * launch. As written these describe the office generically and correctly, but
 * a government office page should quote its real mandate, statements and
 * staffing.
 */
export const officeAbout = {
  mandate:
    "The City Veterinary Office is the city government's technical arm for animal health, animal welfare and livestock development. It runs the city's livestock and poultry dispersal program, delivers veterinary services to residents, and keeps the records that keep animal movement traceable.",
  vision:
    "A livestock-healthy Bayawan City where every dispersed animal is accounted for and every farmer-beneficiary is reached.",
  mission:
    "To deliver accessible veterinary services and a transparent, geo-tagged dispersal program that puts livestock support in the hands of qualified resident farmers.",
  goals: [
    "Expand the livestock and poultry dispersal program to qualified farmers in every barangay.",
    "Protect public health through city-wide rabies prevention and animal health monitoring.",
    "Keep one accurate, geo-tagged record per dispersed animal from release to re-dispersal.",
    "Give the city report-ready program data for planning and fund utilisation reviews.",
  ],
  responsibilities: [
    "Implement city ordinances and national programs on animal health and welfare.",
    "Administer the livestock and poultry dispersal and re-dispersal program.",
    "Provide vaccination, deworming, consultation and treatment services.",
    "Respond to animal health concerns and stray animal reports.",
    "Issue veterinary health certificates for animal transport and sale.",
    "Maintain the geo-tagged records behind the public transparency dashboard.",
  ],
  // The office's staffing outline. TEMPLATE COPY — replace with the real
  // plantilla before launch.
  structure: [
    { unit: "City Veterinarian", detail: "Heads the office; oversees programs and issuances." },
    { unit: "Veterinary aides & field technicians", detail: "Capture records on site, run outreach, monitor beneficiaries." },
    { unit: "Administrative support", detail: "Keeps the records, reports and the office's daily operations running." },
  ],
};

/**
 * The address the Contact section's embedded map and its "Get directions"
 * link target: the office's plus code on the National Road. Deliberately NOT
 * the office's mailing address (that is the contact profile in System
 * Settings) — this is the pin people navigate to.
 *
 * `query` is the FULL plus code (local code "9R67+J7C" completed with
 * Bayawan's reference area "6QX4"): a short code plus free-text keywords
 * makes the map's geocoder guess the locality, and the guess can land a
 * municipality north. The full code is globally unambiguous.
 *
 * `coords` is the same plus code decoded to coordinates — the destination
 * the in-system directions route draws toward. Deliberately NOT the System
 * Settings office pin (that serves the route planner's start-point fallback);
 * the contact map and its directions follow the published navigation address.
 */
export const officeMap = {
  label: "9R67+J7C, National Road, Bayawan City, Negros Oriental",
  query: "6QX49R67+J7C",
  coords: { lat: 9.364, lng: 122.8106 },
};

/**
 * Frequently asked questions for the Services section. TEMPLATE COPY — the
 * answers restate the service cards above; verify each against what the
 * office actually does before launch. Rendered with native <details>, like
 * the service cards.
 */
export const faqs = [
  {
    question: "Is the anti-rabies vaccination really free?",
    answer:
      "Yes — the office's rabies vaccination drives are free of charge as part of the city's public-health program, both at the office and during barangay outreach schedules.",
  },
  {
    question: "How do I apply for the livestock dispersal program?",
    answer:
      "File your intent to avail at the City Veterinary Office with your barangay certification. Field staff will validate your household and site, and on approval your animal is released and geo-tagged to your location.",
  },
  {
    question: "What does 're-dispersal' mean for me as a beneficiary?",
    answer:
      "The offspring of a dispersed animal are passed on to the next qualified farmer in line. It is how the program keeps reaching new households — the animal you receive is the start of that chain.",
  },
  {
    question: "Do I need an appointment for consultation?",
    answer:
      "Walk-ins are accommodated during office hours. For large animals that cannot be brought in, call ahead to schedule a site visit.",
  },
  {
    question: "Where do I report a stray animal or an animal health concern?",
    answer:
      "Contact the office directly (see the contact section) or reach out through your barangay. Reports are logged and routed to the field team.",
  },
  {
    question: "What do the numbers on the transparency page mean?",
    answer:
      "They are aggregate counts from the office's own records — animals dispersed, barangays covered, re-dispersals, vaccination compliance. No farmer or animal is identifiable from anything published there.",
  },
];

/** The four capability highlights for the "how the office runs the program" cards. */
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
