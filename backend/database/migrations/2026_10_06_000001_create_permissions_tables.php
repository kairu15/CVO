<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The permission system: a `permissions` catalog and a `role_permissions`
     * pivot keyed by the users.role string.
     *
     * SEED = the de facto permission set, reverse-engineered from the
     * Policies, middleware and FormRequests as they stood before this
     * migration — so enabling it changes nobody's access on day one. From
     * here, an administrator can adjust grants from the Roles & Permissions
     * screen without a deploy.
     *
     * Deliberate design boundary: the matrix gates CAPABILITIES ("may this
     * role create health records at all?"). Row-level SCOPE (all / assigned /
     * own) stays role-driven inside the Policies — expressible as checkbox
     * semantics without turning the matrix into a second authorization
     * engine. A capability granted to a role the scope rules never reach is
     * simply inert for that role.
     *
     * The catalog mirrors what each check actually guards:
     *
     *   Program oversight (the /admin module)
     *     manage_users               AdminController user CRUD + bulk actions
     *     assign_technicians         technician assignment directory + assign
     *     import_monitoring_records  the monitoring workbook import
     *     export_monitoring_records  the monitoring workbook export
     *     view_reports               the city-wide program report (+ charts)
     *     manage_settings            System Settings + symptom hint rules
     *     manage_reference_data      barangays & puroks
     *     manage_roles               the Roles & Permissions matrix itself
     *     view_activity_logs         the security audit trail
     *
     *   Records — each gated by the matching Policy method; the Policy keeps
     *   the row-scope rules (admin/doctor all, technician assigned/own,
     *   farmer own) exactly as before.
     *     beneficiaries.view/create/update/delete
     *     monitoring.view/create/update/delete/accept-registration
     *     health_records.view/create/update
     *     case_notes.view/create/update
     *     field_visits.view/create/update
     *     dispersals.view/create/update/delete
     */
    public function up(): void
    {
        Schema::create('permissions', function (Blueprint $table): void {
            $table->id();
            $table->string('key')->unique();
            $table->string('label');
            $table->string('group')->index();
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();
        });

        Schema::create('role_permissions', function (Blueprint $table): void {
            $table->id();
            $table->string('role')->index();
            $table->foreignId('permission_id')->constrained('permissions')->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['role', 'permission_id']);
        });

        $now = now();

        foreach (self::catalog() as $group => $permissions) {
            foreach ($permissions as $sort => [$key, $label, $roles]) {
                $permissionId = DB::table('permissions')->insertGetId([
                    'key' => $key,
                    'label' => $label,
                    'group' => $group,
                    'sort_order' => $sort,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);

                DB::table('role_permissions')->insert(
                    collect($roles)->map(fn (string $role): array => [
                        'role' => $role,
                        'permission_id' => $permissionId,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ])->all(),
                );
            }
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('role_permissions');
        Schema::dropIfExists('permissions');
    }

    /**
     * The de facto set at the moment this table was introduced, with the
     * roles each capability was granted to.
     *
     * @return array<string, list<array{0: string, 1: string, 2: list<string>}>>
     */
    private static function catalog(): array
    {
        $ALL = ['admin', 'doctor', 'technician', 'farmer'];
        $ADMIN = ['admin'];

        return [
            'Program oversight' => [
                ['manage_users', 'Manage user accounts', $ADMIN],
                ['assign_technicians', 'Assign technicians to households', $ADMIN],
                ['import_monitoring_records', 'Import the monitoring workbook', $ADMIN],
                ['export_monitoring_records', 'Export the monitoring workbook', $ADMIN],
                ['view_reports', 'View program reports and charts', $ADMIN],
                ['manage_settings', 'Manage system settings and hint rules', $ADMIN],
                ['manage_reference_data', 'Manage barangays and puroks', $ADMIN],
                ['manage_roles', 'Manage roles and permissions', $ADMIN],
                ['view_activity_logs', 'View the activity log', $ADMIN],
            ],
            'Beneficiaries' => [
                ['beneficiaries.view', 'View beneficiaries', $ALL],
                ['beneficiaries.create', 'Register beneficiaries', ['admin', 'technician', 'farmer']],
                ['beneficiaries.update', 'Edit beneficiary details', ['admin', 'farmer']],
                ['beneficiaries.delete', 'Delete beneficiaries', $ADMIN],
            ],
            'Monitoring records' => [
                ['monitoring.view', 'View monitoring records', $ALL],
                ['monitoring.create', 'Log monitoring visits', ['technician']],
                ['monitoring.update', 'Edit monitoring records', ['admin', 'doctor', 'technician']],
                ['monitoring.delete', 'Delete monitoring records', ['admin', 'technician']],
                ['monitoring.accept-registration', 'Accept registration-created records', $ADMIN],
            ],
            'Health records' => [
                ['health_records.view', 'View health records', $ALL],
                ['health_records.create', 'Write health records', ['doctor']],
                ['health_records.update', 'Edit or delete health records', ['admin', 'doctor']],
            ],
            'Case notes' => [
                ['case_notes.view', 'View case notes', $ALL],
                ['case_notes.create', 'Write case notes', ['doctor']],
                ['case_notes.update', 'Edit or delete case notes', ['admin', 'doctor']],
            ],
            'Field visits' => [
                ['field_visits.view', 'View field visits', $ALL],
                ['field_visits.create', 'Log field visits', ['technician']],
                ['field_visits.update', 'Edit or delete field visits', ['admin', 'technician']],
            ],
            'Dispersals' => [
                ['dispersals.view', 'View dispersal events', $ALL],
                ['dispersals.create', 'Record dispersals', ['admin', 'technician', 'farmer']],
                ['dispersals.update', 'Edit dispersal events', ['admin', 'technician']],
                ['dispersals.delete', 'Delete dispersal events', ['admin', 'technician']],
            ],
        ];
    }
};
