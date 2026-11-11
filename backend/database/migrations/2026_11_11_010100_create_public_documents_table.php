<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Downloadable public documents behind the Transparency page — annual and
 * accomplishment reports, budget and procurement disclosures.
 *
 * Files live on the PRIVATE local disk (storage/app), never the public disk:
 * downloads stream through the controller so the endpoint stays the single
 * door (throttled, auditable later, free to count downloads). Metadata is
 * what the public list reads; the file itself is only reachable by the
 * download route.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('public_documents', function (Blueprint $table): void {
            $table->id();
            $table->string('title', 200);
            $table->text('description')->nullable();
            $table->string('category', 50)->default('other')->index();
            $table->string('disk')->default('local');
            $table->string('file_path');
            $table->string('original_name');
            $table->string('mime', 100);
            $table->unsignedBigInteger('size_bytes');
            // Same publish semantics as announcements: null = draft.
            $table->timestamp('published_at')->nullable()->index();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('public_documents');
    }
};
