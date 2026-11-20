<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Personal contact details for a staff account.
 *
 * These are PROFILE fields, not the household address managed on the
 * Beneficiaries screen. They are optional: existing accounts have no contact
 * number or personal address, and the page must render without them.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('users', 'phone')) {
            Schema::table('users', function (Blueprint $table): void {
                $table->string('phone', 32)->nullable()->after('email');
            });
        }

        if (! Schema::hasColumn('users', 'address')) {
            Schema::table('users', function (Blueprint $table): void {
                $table->string('address', 255)->nullable()->after('phone');
            });
        }
    }

    public function down(): void
    {
        foreach (['address', 'phone'] as $column) {
            if (Schema::hasColumn('users', $column)) {
                Schema::table('users', function (Blueprint $table) use ($column): void {
                    $table->dropColumn($column);
                });
            }
        }
    }
};
