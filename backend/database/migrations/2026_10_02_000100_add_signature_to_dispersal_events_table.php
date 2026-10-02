<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * E-signature for dispersal agreements (item 7).
 *
 * A dispersal hands a live animal to a household, so the recording form
 * captures the recipient's signature as the agreement of record. The image
 * lives on the private `secure` disk (`signature_path`), and the row keeps who
 * captured it and when — the same "pixels are evidence, columns are the data"
 * split the geotagged photos use.
 *
 * The signature is append-only by construction: there is no update endpoint
 * for dispersal events, and DispersalEvent::booted() refuses to rewrite a
 * signature once it is set. A genuinely wrong signature is corrected by
 * recording a new event, never by editing history.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('dispersal_events', function (Blueprint $table): void {
            $table->string('signature_path')->nullable()->after('remarks');
            $table->foreignId('signature_captured_by')
                ->nullable()
                ->after('signature_path')
                ->constrained('users')
                ->nullOnDelete();
            $table->timestamp('signature_captured_at')->nullable()->after('signature_captured_by');
        });
    }

    public function down(): void
    {
        Schema::table('dispersal_events', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('signature_captured_by');
            $table->dropColumn(['signature_path', 'signature_captured_at']);
        });
    }
};
