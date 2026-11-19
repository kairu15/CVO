<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Explain and qualify each capability, rather than leaving administrators
     * with a terse checkbox label.
     *
     * `requires` records the read capability a write needs. It is metadata,
     * but the roles endpoint enforces it when granting/revoking: a role can
     * never be left with delete/edit access but no ability to see the records
     * it is meant to manage.
     */
    public function up(): void
    {
        Schema::table('permissions', function (Blueprint $table): void {
            $table->string('description')->nullable()->after('label');
            $table->string('risk', 20)->default('standard')->after('description');
            $table->json('requires')->nullable()->after('risk');
        });

        foreach ($this->metadata() as $key => $meta) {
            DB::table('permissions')
                ->where('key', $key)
                ->update([
                    'description' => $meta['description'],
                    'risk' => $meta['risk'],
                    'requires' => $meta['requires'] === []
                        ? null
                        : json_encode($meta['requires']),
                ]);
        }
    }

    public function down(): void
    {
        Schema::table('permissions', function (Blueprint $table): void {
            $table->dropColumn(['description', 'risk', 'requires']);
        });
    }

    /**
     * The shipped catalog. Unknown/custom permissions simply keep a null
     * description and no dependencies.
     *
     * @return array<string, array{description: string, risk: string, requires: list<string>}>
     */
    private function metadata(): array
    {
        return [
            'beneficiaries.view' => [
                'description' => 'See household and beneficiary records.',
                'risk' => 'standard',
                'requires' => [],
            ],
            'beneficiaries.create' => [
                'description' => 'Register new beneficiary households.',
                'risk' => 'standard',
                'requires' => ['beneficiaries.view'],
            ],
            'beneficiaries.update' => [
                'description' => 'Edit beneficiary details, contact information and map location.',
                'risk' => 'sensitive',
                'requires' => ['beneficiaries.view'],
            ],
            'beneficiaries.delete' => [
                'description' => 'Delete beneficiary records. This is destructive and should stay rare.',
                'risk' => 'critical',
                'requires' => ['beneficiaries.view'],
            ],
            'case_notes.view' => [
                'description' => 'Read clinical case notes.',
                'risk' => 'standard',
                'requires' => [],
            ],
            'case_notes.create' => [
                'description' => 'Write new clinical case notes.',
                'risk' => 'standard',
                'requires' => ['case_notes.view'],
            ],
            'case_notes.update' => [
                'description' => 'Edit or delete case notes, subject to the author/admin policy.',
                'risk' => 'sensitive',
                'requires' => ['case_notes.view'],
            ],
            'dispersals.view' => [
                'description' => 'See dispersal and ownership-chain records.',
                'risk' => 'standard',
                'requires' => [],
            ],
            'dispersals.create' => [
                'description' => 'Record a dispersal event.',
                'risk' => 'standard',
                'requires' => ['dispersals.view'],
            ],
            'dispersals.update' => [
                'description' => 'Edit existing dispersal events.',
                'risk' => 'sensitive',
                'requires' => ['dispersals.view'],
            ],
            'dispersals.delete' => [
                'description' => 'Delete dispersal events. This is destructive.',
                'risk' => 'critical',
                'requires' => ['dispersals.view'],
            ],
            'manage_dispersal' => [
                'description' => 'Record initial dispersals and pass animals to another household.',
                'risk' => 'sensitive',
                'requires' => ['dispersals.view'],
            ],
            'manage_redispersal' => [
                'description' => 'Re-disperse an animal or return it to CVO custody.',
                'risk' => 'sensitive',
                'requires' => ['dispersals.view'],
            ],
            'void_dispersal_event' => [
                'description' => 'Void an ownership event and recompute the animal chain.',
                'risk' => 'critical',
                'requires' => ['dispersals.view', 'view_flight_path'],
            ],
            'view_flight_path' => [
                'description' => 'View an animal ownership chain and map flight path.',
                'risk' => 'standard',
                'requires' => [],
            ],
            'field_visits.view' => [
                'description' => 'See field visit logs and their verification state.',
                'risk' => 'standard',
                'requires' => [],
            ],
            'field_visits.create' => [
                'description' => 'Log a field visit, including GPS evidence and photos.',
                'risk' => 'standard',
                'requires' => ['field_visits.view'],
            ],
            'field_visits.update' => [
                'description' => 'Edit or delete field visits, subject to the technician/admin policy.',
                'risk' => 'sensitive',
                'requires' => ['field_visits.view'],
            ],
            'health_records.view' => [
                'description' => 'Read health records and clinical history.',
                'risk' => 'standard',
                'requires' => [],
            ],
            'health_records.create' => [
                'description' => 'Write clinical health records.',
                'risk' => 'standard',
                'requires' => ['health_records.view'],
            ],
            'health_records.update' => [
                'description' => 'Edit or delete health records, subject to the author/admin policy.',
                'risk' => 'sensitive',
                'requires' => ['health_records.view'],
            ],
            'monitoring.view' => [
                'description' => 'View livestock monitoring records.',
                'risk' => 'standard',
                'requires' => [],
            ],
            'monitoring.create' => [
                'description' => 'Log a monitoring visit or registration-created record.',
                'risk' => 'standard',
                'requires' => ['monitoring.view'],
            ],
            'monitoring.update' => [
                'description' => 'Edit monitoring records and MOA details.',
                'risk' => 'sensitive',
                'requires' => ['monitoring.view'],
            ],
            'monitoring.delete' => [
                'description' => 'Delete monitoring records. This is destructive.',
                'risk' => 'critical',
                'requires' => ['monitoring.view'],
            ],
            'monitoring.set-moa' => [
                'description' => 'Change whether a household has a signed MOA.',
                'risk' => 'sensitive',
                'requires' => ['monitoring.view'],
            ],
            'manage_users' => [
                'description' => 'Create, edit, deactivate and reactivate staff accounts, and assign roles.',
                'risk' => 'critical',
                'requires' => [],
            ],
            'assign_technicians' => [
                'description' => 'Assign technicians to households and use the assignment directory.',
                'risk' => 'sensitive',
                'requires' => ['beneficiaries.view'],
            ],
            'import_monitoring_records' => [
                'description' => 'Import the monitoring workbook, creating and updating records.',
                'risk' => 'sensitive',
                'requires' => ['monitoring.view'],
            ],
            'export_monitoring_records' => [
                'description' => 'Export the monitoring workbook.',
                'risk' => 'sensitive',
                'requires' => ['monitoring.view'],
            ],
            'view_reports' => [
                'description' => 'View city-wide reports, charts and the admin overview.',
                'risk' => 'standard',
                'requires' => [],
            ],
            'manage_settings' => [
                'description' => 'Edit office settings, reference data and public content.',
                'risk' => 'critical',
                'requires' => [],
            ],
            'manage_reference_data' => [
                'description' => 'Add and edit barangays, puroks and animal reference data.',
                'risk' => 'critical',
                'requires' => [],
            ],
            'manage_roles' => [
                'description' => 'Edit this capability matrix. This is the permission that can change every other permission.',
                'risk' => 'critical',
                'requires' => [],
            ],
            'view_activity_logs' => [
                'description' => 'Read and export the security audit trail.',
                'risk' => 'sensitive',
                'requires' => [],
            ],
            'view_analytics' => [
                'description' => 'View barangay dispersal and re-dispersal analytics.',
                'risk' => 'standard',
                'requires' => [],
            ],
        ];
    }
};
