<?php

namespace App\Support;

/**
 * Human metadata for the fixed staff roles.
 *
 * Roles are an application vocabulary (`User::ROLES`), not a table an
 * administrator creates rows in. Keeping their labels, descriptions and home
 * dashboards here means the matrix endpoint can describe a role without the
 * SPA inventing copy that disagrees with the server.
 */
class RoleCatalog
{
    /**
     * @var array<string, array{label: string, short_label: string, dashboard: string, description: string}>
     */
    private const ROLES = [
        'admin' => [
            'label' => 'Administrator',
            'short_label' => 'Admin',
            'dashboard' => 'Admin Dashboard',
            'description' => 'Owns accounts, permissions and city-wide program oversight. Can open every workspace.',
        ],
        'technician' => [
            'label' => 'Field Technician',
            'short_label' => 'Technician',
            'dashboard' => 'Technician Dashboard',
            'description' => 'Carries the field work: tagging, monitoring, health records, case notes and assigned households.',
        ],
    ];

    /**
     * @return array{label: string, short_label: string, dashboard: string, description: string}
     */
    public static function for(string $role): array
    {
        return self::ROLES[$role] ?? [
            'label' => ucfirst($role),
            'short_label' => ucfirst($role),
            'dashboard' => 'Dashboard',
            'description' => 'No description has been recorded for this role.',
        ];
    }
}
