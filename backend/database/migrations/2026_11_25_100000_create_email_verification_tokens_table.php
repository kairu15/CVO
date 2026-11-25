<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('email_verification_tokens', function (Blueprint $table) {
            $table->id();
            // One live token per account: a resend replaces the row, which is
            // what invalidates the previous link.
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();
            // Only the SHA-256 hash is stored; the raw token exists in the
            // email and in memory long enough to build the link.
            $table->string('token_hash', 64)->index();
            // True when the account was created without a password: a
            // successful verification may then hand back a one-time password
            // broker link so the owner can set one.
            $table->boolean('requires_password_setup')->default(false);
            $table->timestamp('expires_at')->index();
            $table->timestamp('created_at')->nullable();
        });

        // Accounts that existed before email verification was enforced were
        // created by an administrator and already use the system. Without
        // this backfill the login gate would lock every one of them out.
        DB::table('users')
            ->whereNull('email_verified_at')
            ->update(['email_verified_at' => now(), 'updated_at' => now()]);
    }

    public function down(): void
    {
        Schema::dropIfExists('email_verification_tokens');
    }
};
