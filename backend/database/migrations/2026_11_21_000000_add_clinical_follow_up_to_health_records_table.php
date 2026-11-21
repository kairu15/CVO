<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The clinical fields the technician worklist needs without changing the
     * table's meaning: a record is still one examination of one household's
     * animal(s). Follow-up state is derived from dates, never stored twice.
     */
    public function up(): void
    {
        Schema::table('health_records', function (Blueprint $table): void {
            $table->unsignedSmallInteger('animal_quantity')->default(1)->after('beneficiary_id');
            $table->text('symptoms')->nullable()->after('diagnosis');
            $table->date('follow_up_on')->nullable()->after('outcome');
            $table->timestamp('follow_up_completed_at')->nullable()->after('follow_up_on');

            // One supporting clinical photo per examination, stored on the
            // private disk. The path never leaves the API; the resource exposes
            // an authorized stream URL instead.
            $table->string('photo_path')->nullable()->after('remarks');

            $table->index(['follow_up_on', 'follow_up_completed_at']);
        });
    }

    public function down(): void
    {
        Schema::table('health_records', function (Blueprint $table): void {
            $table->dropIndex(['follow_up_on', 'follow_up_completed_at']);
            $table->dropColumn([
                'animal_quantity',
                'symptoms',
                'follow_up_on',
                'follow_up_completed_at',
                'photo_path',
            ]);
        });
    }
};
