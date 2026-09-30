<?php

namespace Database\Seeders;

use App\Models\SymptomRule;
use Illuminate\Database\Seeder;

/**
 * Starter rows for the Rule-Based Health Concern Hints.
 *
 * These are STARTING POINTS, not clinical guidance: each hint is deliberately
 * generic ("consider checking…") and couples a common symptom to a next step a
 * vet would take anyway. The CVO's veterinarian is expected to review, correct
 * and extend them through System Settings — that is why the rules live in the
 * database at all. Keyed by label so re-seeding updates rather than
 * duplicates, and so an admin's edited wording is not clobbered on every
 * deploy (delete a row and it will come back; edit it and it stays).
 */
class SymptomRuleSeeder extends Seeder
{
    public function run(): void
    {
        $rules = [
            [
                'label' => 'Digestive upset',
                'keywords' => ['diarrhea', 'diarrhoea', 'loose stool', 'watery stool', 'vomiting'],
                'hint' => 'Consider checking for dehydration and intestinal parasites.',
                'sort_order' => 10,
            ],
            [
                'label' => 'Poor appetite',
                'keywords' => ['not eating', 'loss of appetite', "won't eat", 'no appetite', 'off feed'],
                'hint' => 'Consider a physical examination and checking for fever or mouth problems.',
                'sort_order' => 20,
            ],
            [
                'label' => 'Fever',
                'keywords' => ['fever', 'high temperature', 'hot to touch'],
                'hint' => 'Consider confirming with a thermometer and checking for signs of infection.',
                'sort_order' => 30,
            ],
            [
                'label' => 'Breathing difficulty',
                'keywords' => ['cough', 'coughing', 'difficulty breathing', 'labored breathing', 'nasal discharge'],
                'hint' => 'Consider a respiratory examination and checking for pneumonia.',
                'sort_order' => 40,
            ],
            [
                'label' => 'Lameness',
                'keywords' => ['limp', 'limping', 'lame', 'lameness'],
                'hint' => 'Consider examining the affected limb for injury or swelling.',
                'sort_order' => 50,
            ],
            [
                'label' => 'Skin problem',
                'keywords' => ['itching', 'sores', 'skin lesion', 'hair loss', 'wound'],
                'hint' => 'Consider examining the skin for parasites, fungal infection or wounds.',
                'sort_order' => 60,
            ],
        ];

        foreach ($rules as $rule) {
            SymptomRule::updateOrCreate(
                ['label' => $rule['label']],
                [...$rule, 'animal_type' => null, 'is_active' => true],
            );
        }
    }
}
