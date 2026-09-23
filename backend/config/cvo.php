<?php

// City Veterinary Office program configuration.
// The barangay list is the single source of truth for the registration
// form's dropdown; the factory/seeders keep their own coordinate table
// (BeneficiaryFactory::BARANGAY_COORDS) used for demo data and geocoding
// fallback only.

return [
    'barangays' => [
        'Ali-Nan-Ban',
        'Banay Banay',
        'Cansumalig',
        'Daw-Kal-Vil',
        'Dawis',
        'Kalumboyan',
        'Tayawan',
    ],

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
];
