<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Completed vaccinations are real historical rows. The follow-up date is
     * stored once on the household's schedule override, so rescheduling does
     * not rewrite the administration record.
     */
    public function up(): void
    {
        Schema::create('vaccinations', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('beneficiary_id')->constrained('beneficiaries')->cascadeOnDelete();
            $table->foreignId('technician_id')->constrained('users');
            $table->string('vaccine_name', 120);
            $table->date('administered_on');
            $table->unsignedSmallInteger('quantity')->default(1);
            $table->string('batch_number', 80)->nullable();
            $table->unsignedSmallInteger('protocol_days');
            $table->date('next_due_on')->nullable();
            $table->text('notes')->nullable();
            $table->string('photo_path')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['beneficiary_id', 'administered_on']);
            $table->index(['next_due_on']);
        });

        Schema::create('vaccination_schedule_overrides', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('beneficiary_id')->unique()->constrained('beneficiaries')->cascadeOnDelete();
            $table->date('next_due_on');
            $table->string('reason', 255)->nullable();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('vaccination_schedule_overrides');
        Schema::dropIfExists('vaccinations');
    }
};
