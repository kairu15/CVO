<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Public contact-form submissions.
 *
 * Every submission is stored (the record survives a mailer outage) AND
 * forwarded to the office email from System Settings when a mailer is
 * configured — the inbox is what the office actually reads, the table is the
 * audit copy. There is deliberately no public status tracking: this is a
 * one-way inquiry form, not a ticketing system.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('contact_messages', function (Blueprint $table): void {
            $table->id();
            $table->string('name', 150);
            $table->string('email', 200);
            $table->string('phone', 50)->nullable();
            $table->string('subject', 200)->nullable();
            $table->text('message');
            // Set when the office marks the inquiry dealt with (reserved for
            // a future admin view; nothing public reads it today).
            $table->timestamp('handled_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('contact_messages');
    }
};
