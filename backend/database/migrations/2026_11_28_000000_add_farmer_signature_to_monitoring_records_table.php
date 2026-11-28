<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Digital farmer signature capture on monthly monitoring visits.
 *
 * The signature is a PNG drawn on the technician's device and stored on the
 * private `secure` disk — never in the public webroot and never as a base64
 * blob in a text column. The columns here are the provenance beside the
 * pixels: who captured it and when.
 *
 * `farmers_signature` (the original free-text confirmation) is left untouched
 * so historical rows keep their typed value; the two are independent.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('monitoring_records', function (Blueprint $table): void {
            $table->string('farmer_signature_path')->nullable()->after('farmers_signature');
            $table->string('signature_mime_type', 64)->nullable()->after('farmer_signature_path');
            $table->timestamp('farmer_signed_at')->nullable()->after('signature_mime_type');
            $table->foreignId('signature_captured_by')
                ->nullable()
                ->after('farmer_signed_at')
                ->constrained('users')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('monitoring_records', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('signature_captured_by');
            $table->dropColumn([
                'farmer_signature_path',
                'signature_mime_type',
                'farmer_signed_at',
            ]);
        });
    }
};
