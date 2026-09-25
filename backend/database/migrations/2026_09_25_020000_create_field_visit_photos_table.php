<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Geotagged field-visit photos.
     *
     * The composited image (metadata panel burned into the pixels) is stored
     * on disk; every structured field from the capture moment is stored here
     * as a real column, so photos are queryable/reportable by location and
     * time without ever reading pixels back.
     *
     * Timezone-free timestamp columns: the capture moment is stored both as
     * the local wall-clock fields the technician saw (date/time parts) and as
     * the UTC instant (captured_at) — the offset string preserves which zone
     * the wall clock was in.
     */
    public function up(): void
    {
        Schema::create('field_visit_photos', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('field_visit_id')->constrained('field_visits')->cascadeOnDelete();
            $table->foreignId('technician_id')->constrained('users')->cascadeOnDelete();

            // The composited image on the `public` disk (storage/app/public,
            // served via /storage). Small — client-side downscale to <=1600px.
            $table->string('image_path');

            // Wall-clock capture fields (device-local, as the reference table).
            $table->date('capture_date');
            $table->time('capture_time');
            $table->string('timezone_offset', 10); // e.g. "UTC+08:00"
            $table->unsignedSmallInteger('capture_year');
            $table->unsignedTinyInteger('capture_month');
            $table->unsignedTinyInteger('capture_day');
            $table->unsignedTinyInteger('capture_hour');
            $table->unsignedTinyInteger('capture_minute');
            $table->unsignedTinyInteger('capture_second');
            $table->unsignedSmallInteger('capture_millisecond')->nullable();

            // The GPS fix.
            $table->decimal('latitude', 10, 7)->nullable();
            $table->decimal('longitude', 10, 7)->nullable();
            $table->decimal('accuracy_m', 6, 2)->nullable();
            $table->decimal('altitude_m', 8, 2)->nullable();
            $table->decimal('speed_kmh', 8, 2)->nullable();
            $table->unsignedSmallInteger('heading_deg')->nullable();
            $table->string('location_source', 16)->nullable(); // gps | network | wifi | none
            $table->string('address')->nullable(); // reverse-geocoded

            $table->timestamps();

            $table->index(['field_visit_id']);
            $table->index(['technician_id', 'capture_date']);
            $table->index(['latitude', 'longitude']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('field_visit_photos');
    }
};
