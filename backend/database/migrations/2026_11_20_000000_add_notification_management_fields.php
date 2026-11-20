<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Management metadata for the existing stored-notification feed.
 *
 * The notification rows already carried type/title/message/read state. These
 * columns add the vocabulary the Notifications screen filters on (category and
 * priority), plus an archive marker so clearing an inbox does not delete the
 * underlying history. They are deliberately denormalized: filtering thousands
 * of rows by category/priority must happen in SQL before pagination, not by
 * walking every row in PHP.
 *
 * Per-user category preferences live on users as a small JSON object. The
 * existing `notify_*` settings remain the organisation-wide switches; this is
 * the individual "what do I want to receive" layer. A missing key means on, so
 * existing accounts and new accounts keep today's behaviour.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('user_notifications', 'category')) {
            Schema::table('user_notifications', function (Blueprint $table): void {
                $table->string('category', 32)->default('system')->after('type');
            });
        }

        if (! Schema::hasColumn('user_notifications', 'priority')) {
            Schema::table('user_notifications', function (Blueprint $table): void {
                $table->string('priority', 16)->default('normal')->after('category');
            });
        }

        if (! Schema::hasColumn('user_notifications', 'archived_at')) {
            Schema::table('user_notifications', function (Blueprint $table): void {
                $table->timestamp('archived_at')->nullable()->after('read_at');
            });
        }

        if (! Schema::hasColumn('users', 'notification_preferences')) {
            Schema::table('users', function (Blueprint $table): void {
                $table->json('notification_preferences')->nullable()->after('role');
            });
        }

        // Backfill existing rows from the same map the model exposes. New rows
        // are written by NotificationService/SmartAlertService; this keeps the
        // historical feed filterable immediately after deploy.
        $meta = [
            'beneficiary-added' => ['beneficiaries', 'normal'],
            'technician-assigned' => ['technicians', 'high'],
            'technician-reassigned' => ['technicians', 'high'],
            'field-visit-photo' => ['field_visits', 'normal'],
            'field-visit-completed' => ['field_visits', 'normal'],
            'animal-dispersed' => ['dispersals', 'normal'],
            'animal-re-dispersed' => ['dispersals', 'normal'],
            'animal-returned' => ['dispersals', 'normal'],
            'animal-event-voided' => ['dispersals', 'high'],
            'smart-vaccination-overdue' => ['monitoring', 'critical'],
            'smart-bcs-out-of-range' => ['monitoring', 'high'],
            'smart-no-recent-visit' => ['field_visits', 'high'],
            'smart-barangay-flag' => ['monitoring', 'high'],
            'cluster-alert' => ['security', 'critical'],
        ];

        foreach ($meta as $type => [$category, $priority]) {
            DB::table('user_notifications')
                ->where('type', $type)
                ->update(['category' => $category, 'priority' => $priority]);
        }

        if (! Schema::hasIndex('user_notifications', 'user_notifications_user_archive_created_index')) {
            Schema::table('user_notifications', function (Blueprint $table): void {
                $table->index(
                    ['user_id', 'archived_at', 'created_at'],
                    'user_notifications_user_archive_created_index',
                );
            });
        }

        if (! Schema::hasIndex('user_notifications', 'user_notifications_user_category_created_index')) {
            Schema::table('user_notifications', function (Blueprint $table): void {
                $table->index(
                    ['user_id', 'category', 'created_at'],
                    'user_notifications_user_category_created_index',
                );
            });
        }

        if (! Schema::hasIndex('user_notifications', 'user_notifications_user_priority_created_index')) {
            Schema::table('user_notifications', function (Blueprint $table): void {
                $table->index(
                    ['user_id', 'priority', 'created_at'],
                    'user_notifications_user_priority_created_index',
                );
            });
        }
    }

    public function down(): void
    {
        foreach ([
            'user_notifications_user_archive_created_index',
            'user_notifications_user_category_created_index',
            'user_notifications_user_priority_created_index',
        ] as $index) {
            if (Schema::hasIndex('user_notifications', $index)) {
                Schema::table('user_notifications', function (Blueprint $table) use ($index): void {
                    $table->dropIndex($index);
                });
            }
        }

        foreach (['archived_at', 'priority', 'category'] as $column) {
            if (Schema::hasColumn('user_notifications', $column)) {
                Schema::table('user_notifications', function (Blueprint $table) use ($column): void {
                    $table->dropColumn($column);
                });
            }
        }

        if (Schema::hasColumn('users', 'notification_preferences')) {
            Schema::table('users', function (Blueprint $table): void {
                $table->dropColumn('notification_preferences');
            });
        }
    }
};
