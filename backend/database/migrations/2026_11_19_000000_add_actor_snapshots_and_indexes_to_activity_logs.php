<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Historical accuracy + investigation indexes.
     *
     * `actor_name`/`actor_email` are snapshots taken by AuditLogger at write
     * time. Before this migration a row's actor was only a foreign key, so
     * deactivating or renaming an account silently changed what the trail
     * said about past events. Existing rows are backfilled from the users
     * table as it stands now — the best available value for old history.
     *
     * The composite indexes match the audit screen's real queries: newest
     * first with one filter (action, actor, role, entity, or IP), rather than
     * the separate single-column indexes alone.
     */
    public function up(): void
    {
        Schema::table('activity_logs', function (Blueprint $table): void {
            $table->string('actor_name')->nullable()->after('actor_id');
            $table->string('actor_email')->nullable()->after('actor_name');

            $table->index(['created_at', 'id'], 'activity_logs_created_id_index');
            $table->index(['action', 'created_at'], 'activity_logs_action_created_index');
            $table->index(['actor_id', 'created_at'], 'activity_logs_actor_created_index');
            $table->index(['actor_role', 'created_at'], 'activity_logs_actor_role_created_index');
            $table->index(['target_type', 'created_at'], 'activity_logs_target_created_index');
            $table->index(['ip_address', 'created_at'], 'activity_logs_ip_created_index');
        });

        $this->backfillActorSnapshots();
    }

    public function down(): void
    {
        Schema::table('activity_logs', function (Blueprint $table): void {
            $table->dropIndex('activity_logs_created_id_index');
            $table->dropIndex('activity_logs_action_created_index');
            $table->dropIndex('activity_logs_actor_created_index');
            $table->dropIndex('activity_logs_actor_role_created_index');
            $table->dropIndex('activity_logs_target_created_index');
            $table->dropIndex('activity_logs_ip_created_index');

            $table->dropColumn(['actor_name', 'actor_email']);
        });
    }

    /**
     * Fill the new columns in bounded batches so a large audit table does not
     * load every row (or every actor) into memory at once.
     */
    private function backfillActorSnapshots(): void
    {
        DB::table('activity_logs')
            ->whereNotNull('actor_id')
            ->whereNull('actor_name')
            ->orderBy('id')
            ->chunkById(500, function ($rows): void {
                $users = DB::table('users')
                    ->whereIn('id', $rows->pluck('actor_id')->unique()->all())
                    ->get(['id', 'name', 'email'])
                    ->keyBy('id');

                foreach ($rows as $row) {
                    $user = $users->get($row->actor_id);

                    if ($user === null) {
                        continue;
                    }

                    DB::table('activity_logs')
                        ->where('id', $row->id)
                        ->update([
                            'actor_name' => $user->name,
                            'actor_email' => $user->email,
                        ]);
                }
            });
    }
};
