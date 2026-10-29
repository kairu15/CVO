# Create "Scope and Limitations of the Study.docx" for the CVO capstone

## Deliverable
A Word document `Scope and Limitations of the Study.docx` saved in the repo root (`C:\Users\kylle\OneDrive\Documents\Kylle 4\CVO`), formatted like your example manuscript images: **Times New Roman 12, double-spaced, justified, first-line indents, bold section headings**, written in future tense ("The system will…").

Per your choices: **Scope only** (no Definition of Terms), **implemented features only** (everything verified in your codebase), office name **"Veterinary Office of the Department of Agriculture"** per your SOP, plus a final **SOP-alignment mapping table** inside the same docx.

## Content design

### Section 1 — Scope and Limitations of the Study (prose, ~5 paragraphs, mirroring the example's structure)

1. **Overview paragraph** — "This study focuses on the development of a Livestock and Poultry Dispersal and Redispersal System with Geotagging for the Veterinary Office of the Department of Agriculture…" It will explicitly name the four functional areas from your SOP (recording and monitoring of dispersal/redispersal records, tracking of location, generating reports, and data analytics) delivered through a centralized web-based platform with a mobile companion application.

2. **Administrator functions** — staff accounts and role-based permissions; beneficiary household registry (barangay, purok, GPS coordinates, RSBSA number, MOA status); recording dispersal, redispersal, pass-on of offspring, and return events as an append-only ownership history corrected only by voiding; e-signature capture on dispersal agreements; animal type/classification records; QR-coded ear-tag cards; technician assignments; audit trail; system settings.

3. **Veterinarian and Field Technician functions** — veterinarian: health records, case notes, derived vaccination schedules (due/overdue), animal health monitoring. Technician: GPS geo-tagging of households via the mobile app, field visits with on-site GPS verification and geotagged photo evidence (location metadata burned into the photo), monthly monitoring records, and **offline mode** — the web application queues record submissions on the device during connectivity interruptions and synchronizes them once back online, with conflicts surfaced for review.

4. **Location tracking, reports, analytics + closing** — interactive dispersal map; **flight path tracking** (the visual trail of one animal's ownership history from the CVO through each beneficiary household, drawn from recorded events); in-system notifications and smart alerts; report generation (Excel program-report exports, monitoring workbook import/export, template-based dispersal report); data analytics charts (dispersal trend, animals per barangay, vaccination compliance, animal-type distribution, technician workload); public transparency dashboard with aggregated, anonymized statistics. Closing sentence "These features aim to…" following the example.

5. **Limitations paragraph** — "However, the study is limited to…" — in-scope module list, then honest exclusions tied to real codebase facts: flight path is reconstructed from recorded dispersal events, **not real-time GPS tracking of animals**; no online beneficiary registration/application; no payment or financial transactions; no automated disease diagnosis (rule-based health hints are decision support only); no online veterinary consultations; in-system notifications only (no SMS gateway); Excel-only exports (no PDF); offline mode limited to the web application's queued submissions (mobile app is online-only); GPS accuracy depends on device signal and verification verdicts are a review aid, not proof of presence; requires stable internet, compatible devices, and sufficient digital literacy; role-based access control and masking of sensitive identifiers (RSBSA) protect beneficiary privacy; the system supports, and does not replace, the professional judgment of the office's veterinarians.

### Section 2 — Alignment table (new bold heading, e.g. "Alignment of the Statement of the Problem with the Scope and Limitations of the Study")

A 3-column table (single-spaced cells for readability): **SOP Question → Corresponding System Functionality (Scope) → Related Limitation**, with one row per SOP item:
- Q1 (current process) → basis/benchmark for the proposed features, documented through interviews and observation
- Q2.1/3.1 (recording & monitoring) → registry, dispersal/redispersal/pass-on/return events, e-signatures, MOA, monitoring & health records, vaccination schedule, audit trail → records managed by authorized staff only; no beneficiary self-registration
- Q2.2/3.2 (location tracking) → geotagging, mobile GPS capture, dispersal map, flight path, verification + geotagged photos → not real-time tracking; GPS accuracy/device-dependent
- Q2.3/3.3 (reports) → Excel exports, workbook import/export, template-based report → Excel only, no PDF
- Q2.4/3.4 (data analytics) → dashboard charts, verification summary, transparency dashboard → aggregate/anonymized public data only
- Q4 (TAM acceptance) and Q5 (ISO/IEC 25010) → evaluation of the developed system across all scoped functionalities → evaluation covers the implemented scope only

## Steps
1. Load the `documents:docx` skill and build the document with the formatting above (headings as bold paragraph headings, not Word style-gimmicks, matching your manuscript).
2. Save as `Scope and Limitations of the Study.docx` in the CVO repo root.
3. Render pages to PNG and run one visual acceptance pass (visual-judge) to verify formatting (spacing, justification, indents, table layout).
4. Open the file in the Documents panel for your review and share the full text in chat.