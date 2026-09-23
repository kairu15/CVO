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
];
