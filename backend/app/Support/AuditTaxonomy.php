<?php

namespace App\Support;

use App\Models\User;

/**
 * How the audit trail is grouped and read.
 *
 * The log stores a single action key. Everything the UI filters by — module,
 * status, "critical" — is derived here, once, so the filter dropdown, the CSV
 * export and the row badges can never disagree about what an action means.
 * No second table and no duplicated logging: this only classifies the rows
 * AuditLogger already writes.
 */
class AuditTaxonomy
{
    public const STATUS_SUCCESS = 'success';

    public const STATUS_FAILED = 'failed';

    public const STATUS_SECURITY = 'security';

    /**
     * Filterable modules. Action lists take precedence; target types are the
     * fallback for actions added later by the generic Auditable trait.
     *
     * @var array<string, array{label: string, actions: list<string>, target_types: list<string>}>
     */
    public const MODULES = [
        'authentication' => [
            'label' => 'Authentication',
            'actions' => [
                'login', 'logout', 'logout_all', 'failed_login', 'account_locked',
                'token_issued', 'password_changed', 'password_reset_requested',
                'password_reset_completed',
            ],
            'target_types' => [],
        ],
        'access_control' => [
            'label' => 'Access control',
            'actions' => [
                'role_changed', 'permissions_updated', 'access_denied',
            ],
            'target_types' => ['Permission'],
        ],
        'accounts' => [
            'label' => 'Accounts',
            'actions' => [
                'user_created', 'user_invited', 'user_updated', 'user_deactivated',
                'user_reactivated', 'setup_link_resent', 'sessions_revoked',
            ],
            'target_types' => ['User'],
        ],
        'beneficiaries' => [
            'label' => 'Beneficiaries',
            'actions' => [
                'beneficiary_created', 'beneficiary_updated', 'beneficiary_deleted',
                'technician_assigned',
            ],
            'target_types' => ['Beneficiary', 'TechnicianAssignment'],
        ],
        'monitoring' => [
            'label' => 'Monitoring records',
            'actions' => [
                'monitoring_created', 'monitoring_updated', 'monitoring_deleted',
                'monitoring_accepted', 'monitoring_moa_updated',
                'cluster_alert_created', 'cluster_alert_reviewed',
            ],
            'target_types' => ['MonitoringRecord', 'ClusterAlert'],
        ],
        'clinical' => [
            'label' => 'Clinical records',
            'actions' => [
                'health_record_created', 'health_record_updated', 'health_record_deleted',
                'case_note_created', 'case_note_updated', 'case_note_deleted',
            ],
            'target_types' => ['HealthRecord', 'CaseNote'],
        ],
        'field_visits' => [
            'label' => 'Field visits',
            'actions' => [
                'field_visit_created', 'field_visit_updated', 'field_visit_deleted',
                'field_visit_photo_uploaded', 'field_visit_photo_deleted',
                'field_visit_verification', 'field_visit_verification_note',
            ],
            'target_types' => ['FieldVisit'],
        ],
        'dispersal' => [
            'label' => 'Dispersal',
            'actions' => [
                'dispersal_created', 'dispersal_updated', 'dispersal_deleted',
                'animal_created', 'animal_updated', 'animal_deleted',
                'dispersal_recorded', 're_dispersal_recorded', 'pass_on_recorded',
                'return_recorded', 'dispersal_event_voided',
            ],
            'target_types' => ['DispersalEvent', 'Animal'],
        ],
        'settings' => [
            'label' => 'Settings & reference data',
            'actions' => [
                'settings_updated', 'reference_data_updated',
                'animal_type_created', 'animal_type_updated', 'animal_type_deleted',
                'animal_classification_created', 'animal_classification_updated',
                'animal_classification_deleted',
            ],
            'target_types' => ['Setting', 'Barangay', 'Purok', 'AnimalType', 'AnimalClassification'],
        ],
        'data_transfer' => [
            'label' => 'Imports & exports',
            'actions' => [
                'exported', 'imported', 'file_uploaded', 'file_deleted',
            ],
            'target_types' => [],
        ],
    ];

    /** Actions that represent a failed operation. */
    public const FAILED_ACTIONS = ['failed_login'];

    /**
     * Security-significant events, including failed authentication, lockouts
     * and refused access. `failed_login` appears here too on purpose — the
     * "Security events" filter is broader than the "Failed" filter.
     */
    public const SECURITY_ACTIONS = [
        'failed_login', 'account_locked', 'access_denied',
        'permissions_updated', 'sessions_revoked',
    ];

    /** Successful sign-ins, including mobile token issuance. */
    public const LOGIN_ACTIONS = ['login', 'token_issued'];

    /** Events worth surfacing in the overview's "critical actions" figure. */
    public const CRITICAL_ACTIONS = [
        'role_changed', 'permissions_updated', 'access_denied',
        'user_created', 'user_invited', 'user_deactivated', 'user_reactivated',
        'sessions_revoked', 'settings_updated', 'reference_data_updated',
        'imported', 'exported', 'account_locked', 'dispersal_event_voided',
        'beneficiary_deleted', 'monitoring_deleted', 'health_record_deleted',
        'case_note_deleted', 'field_visit_deleted', 'animal_deleted',
        'dispersal_deleted',
    ];

    /**
     * Statuses the filter and the row badge use.
     *
     * @return list<array{value: string, label: string}>
     */
    public static function statuses(): array
    {
        return [
            ['value' => self::STATUS_SUCCESS, 'label' => 'Successful'],
            ['value' => self::STATUS_FAILED, 'label' => 'Failed'],
            ['value' => self::STATUS_SECURITY, 'label' => 'Security events'],
        ];
    }

    /**
     * @return list<array{value: string, label: string}>
     */
    public static function modules(): array
    {
        return collect(self::MODULES)
            ->map(fn (array $module, string $key): array => [
                'value' => $key,
                'label' => $module['label'],
            ])
            ->values()
            ->all();
    }

    /**
     * @return list<array{value: string, label: string}>
     */
    public static function roles(): array
    {
        return collect(User::ROLES)
            ->map(fn (string $role): array => [
                'value' => $role,
                'label' => ucfirst($role),
            ])
            ->values()
            ->all();
    }

    /** The module a row belongs to, for the table and the export. */
    public static function moduleFor(string $action, ?string $targetType): string
    {
        foreach (self::MODULES as $key => $module) {
            if (in_array($action, $module['actions'], true)) {
                return $key;
            }
        }

        if ($targetType !== null) {
            foreach (self::MODULES as $key => $module) {
                if (in_array($targetType, $module['target_types'], true)) {
                    return $key;
                }
            }
        }

        return 'system';
    }

    public static function moduleLabel(string $module): string
    {
        return self::MODULES[$module]['label'] ?? 'System';
    }

    /** Actions matching a module filter. */
    public static function actionsForModule(string $module): array
    {
        return self::MODULES[$module]['actions'] ?? [];
    }

    /** Target types matching a module filter (fallback for generic actions). */
    public static function targetTypesForModule(string $module): array
    {
        return self::MODULES[$module]['target_types'] ?? [];
    }

    public static function statusFor(string $action): string
    {
        if (in_array($action, self::FAILED_ACTIONS, true)) {
            return self::STATUS_FAILED;
        }

        if (in_array($action, self::SECURITY_ACTIONS, true)) {
            return self::STATUS_SECURITY;
        }

        return self::STATUS_SUCCESS;
    }

    /** Actions matching a status filter. */
    public static function actionsForStatus(string $status): array
    {
        return match ($status) {
            self::STATUS_FAILED => self::FAILED_ACTIONS,
            self::STATUS_SECURITY => self::SECURITY_ACTIONS,
            default => [],
        };
    }

    public static function isCritical(string $action): bool
    {
        return in_array($action, self::CRITICAL_ACTIONS, true);
    }
}
