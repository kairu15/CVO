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
    | This list is the single source of truth: the API validates against it and
    | serves it to the form, so adding an outcome is a change here and nowhere
    | else. `health_records.outcome` is a string column for that reason — no
    | migration is needed to extend the list.
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
    | by Animal Health Monitoring to count an animal's open cases, and mirrors
    | the vocabulary in `health_outcomes` so the two cannot drift.
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
    | Same single-source-of-truth pattern as the outcomes above: the API
    | validates against this list and serves it to the form.
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
    |   is where a per-species exception goes, e.g. ['Swine' => [2, 3]]. Setting
    |   BOTH to empty DISABLES the rule.
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
];
