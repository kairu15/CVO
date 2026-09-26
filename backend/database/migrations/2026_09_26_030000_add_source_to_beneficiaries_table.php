<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Where a beneficiary row came from — 'registration' (a farmer signed up
     * or staff registered the household) or 'import' (auto-created by the
     * admin's Excel import from the monitoring workbook, keyed on
     * name+address). The delete-cleanup rule keys off this: deleting an
     * imported monitoring record also removes its import-created beneficiary
     * when nothing else references it, so deleted sheets stop leaving
     * phantom households behind. Registration rows are never touched.
     */
    public function up(): void
    {
        Schema::table('beneficiaries', function (Blueprint $table): void {
            $table->string('source', 20)->default('registration')->after('sex')->index();
        });
    }

    public function down(): void
    {
        Schema::table('beneficiaries', function (Blueprint $table): void {
            $table->dropIndex(['source']);
            $table->dropColumn('source');
        });
    }
};
