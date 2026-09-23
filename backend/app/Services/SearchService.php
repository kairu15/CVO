<?php

namespace App\Services;

use App\Models\Beneficiary;
use App\Models\MonitoringRecord;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Global header search — a thin, role-scoped read over the records that
 * already exist.
 *
 * One endpoint answers three questions the header implies: where does this
 * household live (beneficiaries), what has been recorded against it
 * (monitoring records), and who do I call about it (accounts, staff only).
 * No index, no new table — the program's data is small enough that a bounded
 * `LIKE` scan per request is honest, and an index would be a second copy of
 * the truth to keep warm.
 *
 * Every query is scoped through the same services the list pages use, so a
 * technician can never search their way to another technician's household and
 * a farmer never sees anyone's records but their own. Search adds no new
 * visibility; it only shortcuts to rows the user could already list.
 *
 * Accounts appear for staff only: farmers and technicians have no screen a
 * user row could link to, and a farmer's search naming other people's
 * accounts would itself be a disclosure.
 */
class SearchService
{
    /** Matches kept per group before ranking. Generous: ranking narrows later. */
    public const PER_GROUP_LIMIT = 10;

    public function __construct(
        private readonly BeneficiaryService $beneficiaries,
        private readonly MonitoringRecordService $records,
    ) {}

    /**
     * Role-scoped search across the searchable groups.
     *
     * @return array{groups: list<array<string, mixed>>, total: int}
     */
    public function search(User $user, string $term): array
    {
        $term = mb_strtolower(trim($term));

        // Drop empty groups inline: accountGroup can also return null (not
        // a group with zero hits) when the caller has no business in it.
        $groups = [];

        foreach ([
            $this->beneficiaryGroup($user, $term),
            $this->recordGroup($user, $term),
            $this->accountGroup($user, $term),
        ] as $group) {
            if ($group !== null && $group['total'] > 0) {
                $groups[] = $group;
            }
        }

        return [
            'groups' => $groups,
            'total' => array_sum(array_column($groups, 'total')),
        ];
    }

    /**
     * Households — the anchor of the program and the first thing staff look
     * for. Ranked: a name match leads an address match, because "Aling Nena"
     * is a more specific intent than "Banay Banay".
     */
    private function beneficiaryGroup(User $user, string $term): array
    {
        $rows = $this->beneficiaries->scopeQueryFor($user)
            ->where(function ($q) use ($term): void {
                $q->whereRaw('LOWER(name_of_farmer) LIKE ?', ["%{$term}%"])
                    ->orWhereRaw('LOWER(address) LIKE ?', ["%{$term}%"])
                    ->orWhereRaw('LOWER(animal_type) LIKE ?', ["%{$term}%"]);
            })
            ->limit(self::PER_GROUP_LIMIT)
            ->get(['id', 'name_of_farmer', 'address', 'animal_type', 'sex']);

        $ranked = $this->rank($rows, $term, fn (Beneficiary $b): array => [
            $b->name_of_farmer,
            $b->address,
            $b->animal_type,
        ]);

        return [
            'type' => 'beneficiary',
            'label' => 'Households',
            'total' => $rows->count(),
            'results' => array_map(
                fn (Beneficiary $b): array => [
                    'id' => $b->id,
                    'title' => $b->name_of_farmer,
                    'subtitle' => trim("{$b->animal_type} ({$b->sex}) — {$b->address}"),
                    'link' => $this->beneficiaryLink($user, $b->id),
                ],
                $ranked,
            ),
        ];
    }

    /**
     * Monitoring visits — found through what was written about them (remarks)
     * or through the household they belong to.
     */
    private function recordGroup(User $user, string $term): array
    {
        $beneficiaryIds = $this->beneficiaries->scopeQueryFor($user)->select('id');

        $rows = MonitoringRecord::query()
            ->whereIn('beneficiary_id', $beneficiaryIds)
            ->where(function ($q) use ($term): void {
                $q->whereRaw('LOWER(remarks) LIKE ?', ["%{$term}%"])
                    ->orWhereHas('beneficiary', function ($bq) use ($term): void {
                        $bq->whereRaw('LOWER(name_of_farmer) LIKE ?', ["%{$term}%"])
                            ->orWhereRaw('LOWER(address) LIKE ?', ["%{$term}%"]);
                    });
            })
            ->with('beneficiary:id,name_of_farmer,address,animal_type,sex')
            ->orderByDesc('date_monitored')
            ->orderByDesc('id')
            ->limit(self::PER_GROUP_LIMIT)
            ->get();

        return [
            'type' => 'monitoring-record',
            'label' => 'Monitoring visits',
            'total' => $rows->count(),
            'results' => $rows->map(fn (MonitoringRecord $r): array => [
                'id' => $r->id,
                'title' => $r->beneficiary?->name_of_farmer ?? 'Monitoring visit',
                // "Carabao (F) — Banay Banay · 2026-09-20"
                'subtitle' => trim(($r->beneficiary
                    ? "{$r->beneficiary->animal_type} ({$r->beneficiary->sex}) — {$r->beneficiary->address} · "
                    : '').($r->date_monitored?->toDateString() ?? '')),
                'link' => "/dashboard/{$user->role}/monitoring",
            ])->all(),
        ];
    }

    /**
     * Accounts — staff-only, and never the actor's own row (their own name is
     * already on screen in the header; searching it should not list oneself).
     */
    private function accountGroup(User $user, string $term): ?array
    {
        if (! in_array($user->role, ['admin', 'doctor'], true)) {
            return null;
        }

        $rows = User::query()
            ->where('id', '!=', $user->id)
            ->where(function ($q) use ($term): void {
                $q->whereRaw('LOWER(name) LIKE ?', ["%{$term}%"])
                    ->orWhereRaw('LOWER(email) LIKE ?', ["%{$term}%"])
                    ->orWhereRaw('LOWER(username) LIKE ?', ["%{$term}%"]);
            })
            ->limit(self::PER_GROUP_LIMIT)
            ->get(['id', 'name', 'email', 'role']);

        if ($rows->isEmpty()) {
            return null;
        }

        return [
            'type' => 'account',
            'label' => 'Accounts',
            'total' => $rows->count(),
            'results' => $rows->map(fn (User $u): array => [
                'id' => $u->id,
                'title' => $u->name,
                'subtitle' => "{$u->email} · {$u->role}",
                'link' => '/dashboard/admin/users',
            ])->all(),
        ];
    }

    /**
     * Keep the group's `total` honest about the pre-limit hit count, then
     * order the kept rows by which field matched.
     *
     * @param  iterable<\Illuminate\Database\Eloquent\Model>  $rows
     * @param  list<string>  $fields  Highest-priority field first.
     * @return list<\Illuminate\Database\Eloquent\Model>
     */
    private function rank(iterable $rows, string $term, callable $fieldsOf): array
    {
        $scored = [];

        foreach ($rows as $row) {
            $fields = array_map(
                fn (?string $value): string => mb_strtolower((string) $value),
                $fieldsOf($row),
            );

            $position = null;

            foreach ($fields as $index => $value) {
                if ($value !== '' && str_contains($value, $term)) {
                    $position = $index;
                    break;
                }
            }

            // Matched by a field that has since changed? Keep it, ranked last:
            // dropping a row the query matched would be worse than a bad rank.
            $scored[] = [$position ?? PHP_INT_MAX, $row];
        }

        usort($scored, fn (array $a, array $b): int => $a[0] <=> $b[0]);

        return array_column($scored, 1);
    }

    /**
     * Where a household result should land. Staff open the household's
     * lineage on the map; a farmer is redirected to their own monitoring page,
     * the one screen that shows their animals' detail today.
     */
    private function beneficiaryLink(User $user, int $id): string
    {
        if ($user->role === 'farmer') {
            return '/dashboard/farmer/monitoring';
        }

        return "/dashboard/{$user->role}/beneficiaries/{$id}/lineage";
    }
}
