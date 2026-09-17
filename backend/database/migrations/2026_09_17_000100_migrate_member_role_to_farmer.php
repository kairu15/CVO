<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * The starter template shipped an "admin"/"member" pair. The CVO system
     * needs "admin"/"doctor"/"technician"/"farmer", so every existing
     * "member" becomes a "farmer" — nobody loses their account.
     */
    public function up(): void
    {
        DB::table('users')->where('role', 'member')->update(['role' => 'farmer']);

        Schema::table('users', function (Blueprint $table): void {
            $table->string('role', 20)->default('farmer')->change();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        DB::table('users')->where('role', 'farmer')->update(['role' => 'member']);

        Schema::table('users', function (Blueprint $table): void {
            $table->string('role', 20)->default('member')->change();
        });
    }
};
