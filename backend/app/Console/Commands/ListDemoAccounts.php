<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;

/**
 * Find accounts left over from early demo seeding.
 *
 * The demo accounts were created with `@example.com` addresses (admin, doctor,
 * technician). DatabaseSeeder no longer writes them: it keys on `username` and
 * rewrites the address, so re-seeding updates the `admin` and `technician` rows
 * in place — but anything seeded under a username the seeder no longer knows
 * (the `doctor` account) stays behind, and shows up in User Management looking
 * like a real colleague.
 *
 * This command only REPORTS. It never deletes or deactivates anything: which
 * accounts are real people is a decision for the administrator, and a wrong
 * guess here would revoke somebody's access. Removal is the ordinary,
 * reversible path on the User Management screen:
 *
 *   User Management → find the account → Deactivate
 *
 * (Deactivation is the system's soft delete — the account can be restored with
 * Reactivate, and the rows it references stay intact. Deleting the row is never
 * required.) `php artisan db:seed` then rewrites the addresses of the staff
 * accounts the seeder does manage.
 */
class ListDemoAccounts extends Command
{
    protected $signature = 'users:demo-accounts';

    protected $description = 'Report leftover demo accounts (@example.com) and how to remove them safely';

    public function handle(): int
    {
        $accounts = User::withTrashed()
            ->where('email', 'like', '%@example.com')
            ->orderBy('id')
            ->get(['id', 'name', 'username', 'email', 'role', 'last_login_at', 'deleted_at']);

        if ($accounts->isEmpty()) {
            $this->info('No demo accounts (@example.com) found — nothing to clean up.');

            return self::SUCCESS;
        }

        $this->table(
            ['id', 'name', 'username', 'email', 'role', 'last sign-in', 'state'],
            $accounts->map(fn (User $user) => [
                $user->id,
                $user->name,
                $user->username ? '@'.$user->username : '—',
                $user->email,
                $user->role,
                $user->last_login_at?->toDateTimeString() ?? 'never',
                $user->trashed() ? 'deactivated' : 'active',
            ])->all(),
        );

        $this->newLine();
        $this->line('These are demo leftovers unless a real person owns one of those addresses.');
        $this->line('To remove one: User Management → the account → Deactivate (reversible with Reactivate).');
        $this->line('Re-running the seeder updates the accounts it manages by username, not these rows.');

        return self::SUCCESS;
    }
}
