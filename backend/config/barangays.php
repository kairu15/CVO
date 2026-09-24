<?php

// Official barangay coverage of Bayawan City (Negros Oriental) — the single
// source of truth for the program's location data.
//
// The database barangays/puroks tables are seeded from this file, and every
// runtime coordinate fallback (geocoding miss, public map pins, demo seeders)
// reads the centers through App\Support\BarangayCenters. Coordinates are the
// barangay centers as mapped in OpenStreetMap (geocoded 2026-09).
//
// Puroks/sitios are NOT listed here — they live only in the database, seeded
// with clearly-marked placeholders until the CVO supplies the real list.

return [
    'entries' => [
        ['name' => 'Ali-is', 'latitude' => 9.5325654, 'longitude' => 122.8933552],
        ['name' => 'Banaybanay', 'latitude' => 9.5526855, 'longitude' => 122.8242983],
        ['name' => 'Banga', 'latitude' => 9.3699825, 'longitude' => 122.7960402],
        ['name' => 'Boyco', 'latitude' => 9.3630844, 'longitude' => 122.803233],
        ['name' => 'Bugay', 'latitude' => 9.6298249, 'longitude' => 122.8334743],
        ['name' => 'Cansumalig', 'latitude' => 9.4358945, 'longitude' => 122.9349204],
        ['name' => 'Dawis', 'latitude' => 9.5766683, 'longitude' => 122.8819134],
        ['name' => 'Kalamtukan', 'latitude' => 9.5774181, 'longitude' => 122.7774203],
        ['name' => 'Kalumboyan', 'latitude' => 9.5050493, 'longitude' => 122.8107091],
        ['name' => 'Malabugas', 'latitude' => 9.3710771, 'longitude' => 122.764117],
        ['name' => 'Mandu-ao', 'latitude' => 9.6772801, 'longitude' => 122.7987658],
        ['name' => 'Maninihon', 'latitude' => 9.3968668, 'longitude' => 122.8657387],
        ['name' => 'Minaba', 'latitude' => 9.4242103, 'longitude' => 122.7495334],
        ['name' => 'Nangka', 'latitude' => 9.3982372, 'longitude' => 122.8165376],
        ['name' => 'Narra', 'latitude' => 9.4512633, 'longitude' => 122.8841175],
        ['name' => 'Pagatban', 'latitude' => 9.3765191, 'longitude' => 122.7409194],
        ['name' => 'Poblacion', 'latitude' => 9.3660575, 'longitude' => 122.8091432],
        ['name' => 'San Isidro', 'latitude' => 9.4168949, 'longitude' => 122.9106569],
        ['name' => 'San Jose', 'latitude' => 9.661027, 'longitude' => 122.8347556],
        ['name' => 'San Miguel', 'latitude' => 9.4103525, 'longitude' => 122.7266917],
        ['name' => 'San Roque', 'latitude' => 9.4024067, 'longitude' => 122.7695862],
        ['name' => 'Suba (Poblacion)', 'latitude' => 9.3619612, 'longitude' => 122.7994975],
        ['name' => 'Tabuan', 'latitude' => 9.5201449, 'longitude' => 122.8450951],
        ['name' => 'Tayawan', 'latitude' => 9.4995966, 'longitude' => 122.7398316],
        ['name' => 'Tinago (Poblacion)', 'latitude' => 9.3619466, 'longitude' => 122.8066204],
        ['name' => 'Ubos (Poblacion)', 'latitude' => 9.3697168, 'longitude' => 122.8046807],
        ['name' => 'Villasol (Bato)', 'latitude' => 9.6107657, 'longitude' => 122.7778836],
        ['name' => 'Villareal', 'latitude' => 9.3578775, 'longitude' => 122.8227109],
    ],
];
