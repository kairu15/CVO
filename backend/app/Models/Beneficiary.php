<?php

namespace App\Models;

use Database\Factories\BeneficiaryFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasManyThrough;
use Illuminate\Database\Eloquent\SoftDeletes;

class Beneficiary extends Model
{
    /** @use HasFactory<BeneficiaryFactory> */
    use HasFactory, SoftDeletes;

    /**
     * Row origin: auto-created by the admin's monitoring Excel import.
     * The other origin is the column's legacy 'registration' default —
     * the value public self-signups once wrote; admin-entered households
     * still carry it and the import-cleanup rule only keys off 'import'.
     */
    public const SOURCE_IMPORT = 'import';

    protected $fillable = [
        'name_of_farmer',
        // The farmer's national registry ID (RSBSA), beside the name it
        // belongs to. Nullable — not every farmer has one yet.
        'rsbsa_number',
        'address',
        'barangay_id',
        'purok_id',
        'animal_type',
        // Structured twin of `animal_type`: the master-list type and, when
        // recorded, its classification (Boar under Swine (Pig)). The string
        // above stays as the display/sync column; these two are what the
        // filters, grouping and exports resolve against.
        'animal_type_id',
        'classification_id',
        // The human-readable number printed on the animal's physical tag.
        'ear_tag_number',
        // Signed Memorandum of Agreement for this dispersal. Tri-state:
        // null = not yet recorded, true = signed, false = not signed.
        'moa_signed',
        'sex',
        'source',
        'technician_id',
        'latitude',
        'longitude',
        'location_source',
    ];

    protected function casts(): array
    {
        return [
            'latitude' => 'float',
            'longitude' => 'float',
            'barangay_id' => 'integer',
            'purok_id' => 'integer',
            'animal_type_id' => 'integer',
            'classification_id' => 'integer',
            'moa_signed' => 'boolean',
        ];
    }

    /**
     * The display name of the animal: the specific master-list type when
     * mapped, else the legacy free-text value the sheet carried.
     */
    public function typeName(): ?string
    {
        return $this->animalType?->name ?? $this->animal_type;
    }

    /**
     * The technician currently assigned to monitor this beneficiary.
     */
    public function technician(): BelongsTo
    {
        return $this->belongsTo(User::class, 'technician_id');
    }

    /**
     * The barangay this household sits in — the structured twin of the
     * free-text `address` string (which stays the synced display value).
     */
    public function barangay(): BelongsTo
    {
        return $this->belongsTo(Barangay::class);
    }

    /**
     * The master-list species this animal belongs to (nullable on historical
     * rows that could not be mapped safely).
     */
    public function animalType(): BelongsTo
    {
        return $this->belongsTo(AnimalType::class);
    }

    /**
     * The sex/age class within the type (Boar, Sow, Gilt…). Nullable: the old
     * sheets recorded a coarse type, rarely a classification.
     */
    public function animalClassification(): BelongsTo
    {
        return $this->belongsTo(AnimalClassification::class, 'classification_id');
    }

    /**
     * The purok/sitio within the barangay — the finest location grain the
     * program tracks, and what dispersal geo-tagging resolves against.
     */
    public function purok(): BelongsTo
    {
        return $this->belongsTo(Purok::class);
    }

    public function monitoringRecords(): HasMany
    {
        return $this->hasMany(MonitoringRecord::class);
    }

    /**
     * Field visits made to this beneficiary — used by the import-cleanup
     * rule to see whether anything still references an imported household.
     */
    public function fieldVisits(): HasMany
    {
        return $this->hasMany(FieldVisit::class);
    }

    /**
     * Geotagged photos taken on any field visit to this beneficiary — the
     * path MonitoringRecordResource walks to reach a photo from a record.
     */
    public function fieldVisitPhotos(): HasManyThrough
    {
        return $this->hasManyThrough(FieldVisitPhoto::class, FieldVisit::class);
    }

    /**
     * Dispersal events that delivered an animal to this beneficiary.
     */
    public function dispersalEvents(): HasMany
    {
        return $this->hasMany(DispersalEvent::class);
    }

    /**
     * Clinical health records for this beneficiary's animal.
     */
    public function healthRecords(): HasMany
    {
        return $this->hasMany(HealthRecord::class);
    }

    /**
     * Freeform veterinary notes about this beneficiary's animal.
     */
    public function caseNotes(): HasMany
    {
        return $this->hasMany(CaseNote::class);
    }
}
