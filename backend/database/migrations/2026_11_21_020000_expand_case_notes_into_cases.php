<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Case Notes grew from a freeform observation into a case record.
 *
 * The original row remains the case's initial observation (`body`), so every
 * historical note keeps its exact meaning. New columns add the case-level
 * facts (reference, category, status, follow-up, links); `case_note_updates`
 * is the append-only timeline, so follow-up activity never overwrites the
 * original observation or an earlier update.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('case_notes', function (Blueprint $table): void {
            $table->string('reference_number', 24)->nullable()->after('id');
            $table->string('category', 40)->default('general')->after('doctor_id');
            $table->string('status', 20)->default('open')->after('category');
            $table->string('location', 255)->nullable()->after('status');
            $table->text('actions_taken')->nullable()->after('body');
            $table->text('recommendations')->nullable()->after('actions_taken');
            $table->date('follow_up_on')->nullable()->after('recommendations');
            $table->timestamp('follow_up_completed_at')->nullable()->after('follow_up_on');
            $table->foreignId('health_record_id')->nullable()->after('follow_up_completed_at')
                ->constrained('health_records')->nullOnDelete();
            $table->foreignId('field_visit_id')->nullable()->after('health_record_id')
                ->constrained('field_visits')->nullOnDelete();
            $table->string('photo_path')->nullable()->after('field_visit_id');
            $table->timestamp('resolved_at')->nullable()->after('photo_path');

            $table->index(['status', 'date_noted']);
            $table->index(['follow_up_on']);
        });

        // Backfill references for notes that predate the case workflow.
        foreach (DB::table('case_notes')->orderBy('id')->get(['id', 'date_noted']) as $row) {
            $year = $row->date_noted ? substr((string) $row->date_noted, 0, 4) : date('Y');

            DB::table('case_notes')
                ->where('id', $row->id)
                ->update([
                    'reference_number' => 'CN-'.$year.'-'.str_pad((string) $row->id, 5, '0', STR_PAD_LEFT),
                ]);
        }

        Schema::table('case_notes', function (Blueprint $table): void {
            $table->unique('reference_number');
        });

        Schema::create('case_note_updates', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('case_note_id')->constrained('case_notes')->cascadeOnDelete();
            $table->foreignId('doctor_id')->constrained('users');
            $table->date('happened_on');
            $table->text('observations')->nullable();
            $table->text('actions_taken')->nullable();
            $table->text('recommendations')->nullable();
            $table->string('status', 20)->nullable();
            $table->date('follow_up_on')->nullable();
            $table->foreignId('health_record_id')->nullable()->constrained('health_records')->nullOnDelete();
            $table->foreignId('field_visit_id')->nullable()->constrained('field_visits')->nullOnDelete();
            $table->timestamps();

            $table->index(['case_note_id', 'happened_on']);
            $table->index(['doctor_id', 'happened_on']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('case_note_updates');

        Schema::table('case_notes', function (Blueprint $table): void {
            $table->dropForeign(['health_record_id']);
            $table->dropForeign(['field_visit_id']);
            $table->dropUnique(['reference_number']);
            $table->dropIndex(['status', 'date_noted']);
            $table->dropIndex(['follow_up_on']);
            $table->dropColumn([
                'reference_number',
                'category',
                'status',
                'location',
                'actions_taken',
                'recommendations',
                'follow_up_on',
                'follow_up_completed_at',
                'health_record_id',
                'field_visit_id',
                'photo_path',
                'resolved_at',
            ]);
        });
    }
};
