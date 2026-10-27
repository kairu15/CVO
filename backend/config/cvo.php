<?php

// City Veterinary Office program configuration.
// The program's barangay coverage lives in config/barangays.php and is
// seeded into the database `barangays` table (see App\Support\Barangays);
// the registration dropdown and every validation rule read from there.

return [

    /*
    |--------------------------------------------------------------------------
    | Health record outcomes
    |--------------------------------------------------------------------------
    |
    | The vocabulary a veterinarian picks from when closing out a diagnosis.
    | This is the SHIPPED DEFAULT: an administrator edits the live list in
    | System Settings, where it is stored in the settings table. The API
    | validates against the saved list (falling back to this one until the
    | first save) and serves it to the form, so `health_records.outcome` stays
    | a string column — extending the list needs no migration.
    |
    */
    'health_outcomes' => [
        'recovered',
        'improving',
        'ongoing',
        'referred',
        'deceased',
    ],

    /*
    |--------------------------------------------------------------------------
    | Suggested animal types (forms)
    |--------------------------------------------------------------------------
    |
    | The vocabulary the UI forms offer (the registration dropdown mirrors it).
    | It is a SUGGESTION, not a filter on the data: the importer takes the animal
    | types FROM THE WORKBOOK itself. A value matching one of these takes the
    | casing below ("CATTLE" → "Cattle"); every other value is kept as its own
    | type. The Monitoring Records animal-type filter is populated from the
    | types actually present in the data, so imported species appear there even
    | when absent from this list.
    |
    | Only a blank cell becomes "Unspecified".
    |
    */
    'animal_types' => [
        'Carabao',
        'Cattle',
        'Goat',
        'Swine',
        'Boar',
        'Poultry',
        'Horse',
    ],

    /*
    |--------------------------------------------------------------------------
    | Vaccination cycle
    |--------------------------------------------------------------------------
    |
    | How long after a vaccination an animal becomes due again, and how far
    | ahead of that date it starts showing as "due soon".
    |
    | The schedule itself is derived from the last recorded vaccination on
    | `monitoring_records`, so these two numbers are the only inputs it needs.
    | Note this is program-wide: if the CVO ever needs a different cycle per
    | species (a carabao and a batch of poultry do not share one), that is the
    | point to turn this into real data rather than config.
    |
    */
    'vaccination_interval_days' => 180,
    'vaccination_due_soon_days' => 30,

    /*
    |--------------------------------------------------------------------------
    | Open case outcomes
    |--------------------------------------------------------------------------
    |
    | Which of the outcomes above mean the case is still being worked on. Used
    | by Animal Health Monitoring to count an animal's open cases. It is
    | intersected with the live (admin-editable) vocabulary at read time, so
    | an outcome an admin removes cannot linger in the counts.
    |
    | `referred` and `deceased` are deliberately NOT open: both end this
    | clinic's involvement in the case.
    |
    */
    'health_open_outcomes' => ['ongoing', 'improving'],

    /*
    |--------------------------------------------------------------------------
    | Field visit purposes
    |--------------------------------------------------------------------------
    |
    | Why a technician went out. Structured rather than free text so the field
    | log can be summarised later (how many visits were routine monitoring vs
    | a complaint) without re-reading prose.
    |
    | The SHIPPED DEFAULT, like the outcomes above: an administrator edits the
    | live list in System Settings, and the API validates against the saved
    | list (falling back to this one until the first save).
    |
    */
    'field_visit_purposes' => [
        'routine-monitoring',
        'follow-up',
        'vaccination',
        'dispersal',
        'complaint',
        'other',
    ],

    /*
    |--------------------------------------------------------------------------
    | Office contact defaults
    |--------------------------------------------------------------------------
    |
    | Shipped placeholders for the office contact profile. These are the
    | fallbacks System Settings shows and the public pages render until an
    | administrator saves real values over them (stored in the settings
    | table, not here — this file is the deploy-time default, the database is
    | the office's own edit).
    |
    */
    'office' => [
        'email' => 'cvo@example.gov.ph',
        'phone' => '(035) 000-0000',
        'hours' => 'Monday to Friday, 8:00 AM – 5:00 PM',
        'address' => 'City Veterinary Office, City Hall Compound, Bayawan City, Negros Oriental 6221',
    ],

    /*
    |--------------------------------------------------------------------------
    | Smart Alerts — thresholds for the daily rule-based scan
    |--------------------------------------------------------------------------
    |
    | Inputs for `php artisan alerts:compute-smart`, which scans the existing
    | records and writes admin/technician alert rows. There is no model and no
    | training data here: every rule is a plain SQL aggregation and a threshold
    | comparison. Every number below is a DECISION, not a discovered fact, and
    | the ones marked UNCONFIRMED are conservative placeholders the CVO must
    | sign off on before they are treated as clinical truth.
    |
    | - Overdue vaccination deliberately reuses `vaccination_interval_days`
    |   above instead of adding a second number, so the alert and the
    |   Vaccination Schedule screen can never disagree about which animals are
    |   late.
    |
    | - BCS normal ranges decide whether a recorded Body Condition Score is a
    |   concern. `bcs_normal_range` is the GENERAL band applied to every animal
    |   type; `bcs_normal_ranges` maps an animal type to a [min, max] override for
    |   species that need a different band. A species with neither stays
    |   unflagged.
    |
    |   CONFIRMED by the CVO (2026-09-30): general band 2–4 on the system's 1–5
    |   scale. Change it only on a veterinarian's instruction; `bcs_normal_ranges`
    |   is where a per-species exception goes, e.g. ['Swine (Pig)' => [2, 3]].
    |   Keys are the SPECIFIC animal-type names from the master list (System
    |   Settings → Animal types), so a band can finally be defined per type
    |   rather than per loose category. Setting BOTH to empty DISABLES the rule.
    |
    | - `no_recent_visit_days` fires for a household created at least this many
    |   days ago whose latest field visit is older than this — or that has no
    |   recorded visit at all. The age guard keeps newly registered households
    |   (which have had no chance to be visited yet) out of the flag.
    |
    | - Barangay flag rate compares this month's share of "concern" remarks in
    |   a barangay against the city-wide share. UNCONFIRMED: `remarks` is free
    |   text, so the keyword list is a heuristic the CVO should review, and the
    |   minimum-sample / multiplier guards keep a single bad record in a tiny
    |   barangay from flagging the whole area.
    |
    */
    'smart_alerts' => [
        // General band, confirmed by the CVO on 2026-09-30.
        'bcs_normal_range' => [2, 4],
        // Per-species overrides; empty means the general band applies.
        'bcs_normal_ranges' => [],

        'no_recent_visit_days' => 30,

        'concern_remarks' => [
            'sick',
            'disease',
            'diseased',
            'illness',
            'injured',
            'injury',
            'wound',
            'wounded',
            'mortality',
            'deceased',
            'underweight',
            'malnourished',
            'weak',
            'emergency',
        ],

        'barangay_flag_min_records' => 5,
        'barangay_flag_ratio_multiplier' => 1.5,
    ],

    /*
    |--------------------------------------------------------------------------
    | On-site visit verification
    |--------------------------------------------------------------------------
    |
    | `onsite_threshold_m` is the radius, in metres, inside which a captured
    | GPS fix counts as "taken at the registered pin". It is a POLICY NUMBER
    | the office chooses, not a surveying or veterinary standard, and it is
    | editable in System Settings — this is only the shipped default.
    |
    | UNCONFIRMED: 100 m is a provisional placeholder. A fix whose accuracy
    | radius is wider than this threshold is reported as `low_accuracy`
    | rather than `off_site`, so one number governs both the circle and the
    | accuracy gate.
    |
    */
    'verification' => [
        'onsite_threshold_m' => 100,
    ],

    /*
    |--------------------------------------------------------------------------
    | Route planner fallback start point
    |--------------------------------------------------------------------------
    |
    | The CVO office coordinate. Two consumers: the route planner's fallback
    | start when the device cannot report its own location, and the ORIGIN
    | NODE of every animal flight path ("where the animal came from").
    | Editable in System Settings; the public `site` endpoint serves it so the
    | planner can fall back without an admin round-trip. UNCONFIRMED:
    | placeholder for the Bayawan City hall area — the office should confirm
    | the exact pin.
    |
    */
    'office_location' => [
        'latitude' => 9.6311,
        'longitude' => 123.1980,
    ],

    /*
    |--------------------------------------------------------------------------
    | Ownership chain (dispersal / re-dispersal)
    |--------------------------------------------------------------------------
    |
    | How far back a dispersal or re-dispersal may be dated, in days, measured
    | in the application timezone (Asia/Manila). A field record typed up after
    | a week in the barangay is normal; one dated into a previous year is not.
    | There is deliberately no forward window — a future date is never allowed.
    | Editable in System Settings; this is the shipped UNCONFIRMED default.
    |
    */
    'dispersal' => [
        'max_backdate_days' => 30,
    ],

    /*
    |--------------------------------------------------------------------------
    | Spatial cluster scan (Feature 3)
    |--------------------------------------------------------------------------
    |
    | Inputs for `php artisan clusters:scan`, which flags POSSIBLE clusters of
    | health problems for human review. Every number below is a DECISION, not
    | a veterinary standard, and the defaults are UNCONFIRMED placeholders the
    | CVO veterinarian must sign off on before the flags are relied on:
    |
    |   lookback_days          how far back a health record counts (N)
    |   min_cases              cases needed inside the radius to flag (K)
    |   radius_km              neighbourhood radius (R)
    |   reportable_outcomes    which health-record outcomes count as a case.
    |                          The clinical vocabulary is admin-editable in
    |                          System Settings, so this list is intersected
    |                          with the live vocabulary at scan time — an
    |                          outcome an admin removes stops counting.
    |                          The data model has no severity/critical field,
    |                          so outcomes stand in for "reportable".
    |
    | Every alert is labelled a statistical flag for review, never a
    | diagnosis, and public views never see anything finer than barangay.
    |
    */
    'cluster_alerts' => [
        'lookback_days' => 14,
        'min_cases' => 3,
        'radius_km' => 2.0,
        'reportable_outcomes' => ['deceased'],
    ],
];
