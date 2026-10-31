<?php

/**
 * One-off e2e demo data: a handful of beneficiaries across real Bayawan
 * barangays, swine with E2E-tagged ear tags, and active dispersal events
 * (with to_barangay_id snapshots) dated over the last three days — enough
 * for the map pages to render pins, barangay counts and labels.
 */

use App\Models\Animal;
use App\Models\AnimalOwnershipEvent;
use App\Models\Beneficiary;
use App\Models\Barangay;
use App\Models\User;
use Illuminate\Support\Carbon;

$admin = User::where('role', 'admin')->first();
$technician = User::where('role', 'technician')->first();

// Idempotent: clear any previous run of this demo set before re-seeding.
$staleAnimals = Animal::withTrashed()->where('ear_tag_number', 'like', 'E2E-%')->pluck('id');
AnimalOwnershipEvent::whereIn('animal_id', $staleAnimals)->delete();
Animal::withTrashed()->whereIn('id', $staleAnimals)->forceDelete();
Beneficiary::where('name_of_farmer', 'like', 'E2E Farmer %')->delete();

$barangayNames = [
    'Banaybanay', 'Banaybanay', 'Banaybanay',
    'Tabuan', 'Tabuan',
    'Ali-is', 'Ali-is',
    'Dawis',
    'Kalamtukan',
    'Tinago (Poblacion)',
    'Suba (Poblacion)',
    'Nangka',
];

$tagPrefix = 'E2E-' . now()->format('YmdHis');
$index = 0;
$events = 0;

foreach ($barangayNames as $name) {
    $barangay = Barangay::where('name', $name)->first();
    if (! $barangay) {
        continue;
    }

    $beneficiary = Beneficiary::create([
        'name_of_farmer' => 'E2E Farmer ' . (++$index),
        'address' => $name,
        'animal_type' => 'Swine',
        'sex' => $index % 2 === 0 ? 'F' : 'M',
        'contact_number' => '0917' . str_pad((string) (1000000 + $index), 7, '0'),
        'latitude' => $barangay->latitude !== null ? $barangay->latitude + 0.001 * $index : null,
        'longitude' => $barangay->longitude !== null ? $barangay->longitude + 0.001 * $index : null,
        'location_source' => 'manual_pin',
        'barangay_id' => $barangay->id,
        'technician_id' => $technician?->id ?? $admin?->id,
    ]);

    // One to three animals per household, dispersed on one of the last
    // three days.
    $animalCount = ($index % 3) + 1;
    for ($i = 0; $i < $animalCount; $i++) {
        $animal = Animal::create([
            'ear_tag_number' => "{$tagPrefix}-" . str_pad((string) (++$events), 3, '0', STR_PAD_LEFT),
            'animal_type' => 'Swine (Pig)',
            'sex' => $i % 2 === 0 ? 'F' : 'M',
            'status' => 'active',
            // The denormalised mirror of the latest active event's owner.
            'current_owner_id' => $beneficiary->id,
        ]);

        AnimalOwnershipEvent::create([
            'animal_id' => $animal->id,
            'event_type' => AnimalOwnershipEvent::TYPE_DISPERSAL,
            'from_beneficiary_id' => null,
            'to_beneficiary_id' => $beneficiary->id,
            'to_barangay_id' => $barangay->id,
            'event_date' => Carbon::today()->subDays($index % 3)->toDateString(),
            'date_is_estimated' => false,
            'location_source' => 'manual_pin',
            'latitude' => $beneficiary->latitude,
            'longitude' => $beneficiary->longitude,
            'status' => AnimalOwnershipEvent::STATUS_ACTIVE,
        ]);
    }
}

// A re-dispersal so the counts have a second event type.
$first = Beneficiary::orderBy('id')->first();
$second = Beneficiary::orderByDesc('id')->first();
if ($first && $second && $first->id !== $second->id) {
    $mover = Animal::where('current_owner_id', $first->id)->first();
    if ($mover) {
        AnimalOwnershipEvent::create([
            'animal_id' => $mover->id,
            'event_type' => AnimalOwnershipEvent::TYPE_RE_DISPERSAL,
            'from_beneficiary_id' => $first->id,
            'from_barangay_id' => $first->barangay_id,
            'to_beneficiary_id' => $second->id,
            'to_barangay_id' => $second->barangay_id,
            'event_date' => Carbon::today()->toDateString(),
            'date_is_estimated' => false,
            'location_source' => 'manual_pin',
            'latitude' => $second->latitude,
            'longitude' => $second->longitude,
            'status' => AnimalOwnershipEvent::STATUS_ACTIVE,
        ]);
        $mover->update(['current_owner_id' => $second->id]);
    }
}

echo 'beneficiaries: ' . Beneficiary::count() . PHP_EOL;
echo 'animals: ' . Animal::count() . PHP_EOL;
echo 'active events: ' . AnimalOwnershipEvent::where('status', 'active')->count() . PHP_EOL;
