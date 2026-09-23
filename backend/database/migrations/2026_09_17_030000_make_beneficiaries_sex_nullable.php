<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The CVO monitoring sheets frequently leave "Sex" blank, so imported
     * beneficiaries may carry no known sex yet.
     */
    public function up(): void
    {
        Schema::table('beneficiaries', function (Blueprint $table): void {
            $table->enum('sex', ['M', 'F'])->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('beneficiaries', function (Blueprint $table): void {
            $table->enum('sex', ['M', 'F'])->nullable(false)->change();
        });
    }
};
