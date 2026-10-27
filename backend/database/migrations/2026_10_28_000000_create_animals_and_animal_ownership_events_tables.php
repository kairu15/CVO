<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The ownership chain: one `animals` row per tagged animal, and an
 * append-only `animal_ownership_events` log of every handover.
 *
 * This is deliberately separate from the older beneficiary-centric
 * `dispersal_events` table. That table models the pass-on PROGRAMME (a
 * household's offspring moving to a new household, each holder being its own
 * beneficiary row); this one models ANIMAL IDENTITY — one animal that keeps a
 * single identity while it moves from owner to owner. The two coexist: the
 * geneaology/pass-on screens keep reading the old table, while the flight path
 * is drawn exclusively from these events.
 *
 * `animals.current_owner_id` is a DENORMALISED cache of the latest active
 * event's `to_beneficiary_id`. It exists so list screens and scope checks do
 * not have to walk the chain, and it is always written in the same
 * transaction as the event it reflects. `ownership:verify` is the check that
 * the cache never drifts from the chain.
 *
 * Events are never edited or deleted: a mistake is corrected by VOIDING the
 * event (status + voided_by/at/reason) and recomputing the chain from the
 * remaining active rows.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('animals', function (Blueprint $table): void {
            $table->id();

            // The number printed on the physical tag. Nullable because a
            // backfilled or imported animal may not have been tagged yet.
            $table->string('ear_tag_number')->nullable()->unique();

            // The master-list pair, mirrored the way beneficiaries store it:
            // a display string beside the resolved FK pair, so a legacy or
            // unmapped value never loses its text.
            $table->string('animal_type')->nullable();
            $table->foreignId('animal_type_id')->nullable()->constrained('animal_types')->nullOnDelete();
            $table->foreignId('classification_id')->nullable()->constrained('animal_classifications')->nullOnDelete();
            $table->enum('sex', ['M', 'F'])->nullable();

            // Offspring linkage for pass-on events.
            $table->foreignId('parent_animal_id')->nullable()->constrained('animals')->nullOnDelete();

            // The denormalised current holder; null while the animal is at CVO.
            $table->foreignId('current_owner_id')->nullable()->constrained('beneficiaries')->nullOnDelete();

            // `returned` marks an animal handed back to CVO, which is no longer
            // eligible for a new handover until it is dispersed again.
            $table->enum('status', ['active', 'deceased', 'returned'])->default('active');

            // Provenance for a row backfilled from the older beneficiary
            // pass-on model: one animal was derived from this household row.
            // It is the backfill command's idempotency key and is null for
            // every animal created through the API.
            $table->foreignId('legacy_beneficiary_id')
                ->nullable()
                ->unique()
                ->constrained('beneficiaries')
                ->nullOnDelete();

            $table->timestamps();
            $table->softDeletes();

            $table->index('current_owner_id');
            $table->index('parent_animal_id');
            $table->index('status');
        });

        Schema::create('animal_ownership_events', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('animal_id')->constrained('animals')->cascadeOnDelete();

            // dispersal    CVO → beneficiary (the first event of a chain)
            // re_dispersal the same animal moving to another beneficiary
            // pass_on      an offspring animal moving to a beneficiary
            // return       a beneficiary handing the animal back to CVO
            $table->enum('event_type', ['dispersal', 're_dispersal', 'pass_on', 'return']);

            // `from` is null when the source is CVO; `to` is null on a return.
            $table->foreignId('from_beneficiary_id')->nullable()->constrained('beneficiaries')->nullOnDelete();
            $table->foreignId('to_beneficiary_id')->nullable()->constrained('beneficiaries')->nullOnDelete();

            $table->date('event_date');

            // True for a backfilled row whose date was inferred, not recorded.
            $table->boolean('date_is_estimated')->default(false);

            // The handover location. Null when nothing could be pinned — the
            // flight path then falls back (owner geotag, then barangay centre)
            // at read time and marks the node approximate.
            $table->decimal('latitude', 10, 7)->nullable();
            $table->decimal('longitude', 10, 7)->nullable();
            $table->enum('location_source', [
                'device_gps',
                'manual_pin',
                'owner_geotag',
                'barangay_centroid',
            ])->nullable();
            $table->decimal('accuracy_m', 8, 2)->nullable();

            $table->text('remarks')->nullable();
            $table->foreignId('recorded_by')->nullable()->constrained('users')->nullOnDelete();

            // Append-only: a wrong event is voided, never edited away.
            $table->enum('status', ['active', 'voided'])->default('active');
            $table->foreignId('voided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('voided_at')->nullable();
            $table->text('void_reason')->nullable();

            $table->timestamps();

            // The chain read: one animal's events, oldest first, stable on
            // equal dates by id.
            $table->index(['animal_id', 'event_date', 'id']);
            $table->index(['animal_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('animal_ownership_events');
        Schema::dropIfExists('animals');
    }
};
