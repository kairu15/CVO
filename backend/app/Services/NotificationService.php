<?php

namespace App\Services;

use App\Models\Beneficiary;
use App\Models\DispersalEvent;
use App\Models\User;
use App\Models\UserNotification;
use App\Support\Like;
use App\Support\Pagination;
use Illuminate\Database\Eloquent\Builder;

/**
 * Notifications — one central feed for stored events and derived alerts.
 *
 * Stored event notifications are written once at the moment something happens
 * (beneficiary added, technician assigned, field visit completed/photo,
 * ownership change, smart-alert scan). They carry read/archive state per
 * recipient. Derived alerts (vaccination and dispersal) are still computed
 * from records already in the system and therefore have no read state.
 *
 * The two streams stay together so the bell and the Notifications page cannot
 * disagree about what happened. Filters run in SQL for stored rows, before
 * pagination; the bounded derived scan is filtered in memory because it is
 * built from aggregate rules rather than a notification table.
 */
class NotificationService
{
    public const TYPE_DISPERSAL = 'dispersal';

    public const TYPE_RE_DISPERSAL = 're-dispersal';

    public const TYPE_VACCINATION_OVERDUE = 'vaccination-overdue';

    public const TYPE_VACCINATION_DUE_SOON = 'vaccination-due-soon';

    /**
     * The derived alert vocabulary, for validation and for the frontend's
     * icon map. Stored types live on UserNotification.
     *
     * @var list<string>
     */
    public const TYPES = [
        self::TYPE_DISPERSAL,
        self::TYPE_RE_DISPERSAL,
        self::TYPE_VACCINATION_OVERDUE,
        self::TYPE_VACCINATION_DUE_SOON,
    ];

    public const URGENCY_URGENT = 'urgent';

    public const URGENCY_WARNING = 'warning';

    public const URGENCY_INFO = 'info';

    /** The whole feed: derived alerts + every stored event. */
    public const FILTER_ALL = 'all';

    /** Just the Smart Alerts — the daily rule-based flags. */
    public const FILTER_SMART = 'smart';

    public const FILTERS = [self::FILTER_ALL, self::FILTER_SMART];

    public const STATUS_ALL = 'all';

    public const STATUS_UNREAD = 'unread';

    public const STATUS_READ = 'read';

    public const STATUS_ARCHIVED = 'archived';

    public const STATUSES = [
        self::STATUS_ALL,
        self::STATUS_UNREAD,
        self::STATUS_READ,
        self::STATUS_ARCHIVED,
    ];

    public const ACTIONS = ['read', 'unread', 'archive', 'unarchive', 'delete'];

    public const DEFAULT_LIMIT = Pagination::DEFAULT_PER_PAGE;

    /**
     * How many matching stored rows are scanned per request. Derived alerts
     * have their own per-rule caps. When a scan is hit, `truncated` says so.
     */
    public const SCAN_CAP = 200;

    /** Set while building the feed when a scan hit its cap. */
    private bool $truncated = false;

    public function __construct(
        private readonly VaccinationScheduleService $schedule,
        private readonly DispersalEventService $dispersals,
        private readonly SettingsService $settings,
    ) {}

    /**
     * Record an event notification for a user at the moment it happens.
     *
     * Both gates are applied here, once: the organisation-wide `notify_*`
     * switch and the recipient's own category preference. That keeps every
     * caller from having to remember either rule.
     */
    public function create(User $recipient, array $attributes): ?UserNotification
    {
        $type = (string) $attributes['type'];

        if (! $this->settings->notificationTypeEnabled($type)) {
            return null;
        }

        $category = (string) ($attributes['category'] ?? UserNotification::categoryFor($type));

        if (! $recipient->wantsNotificationCategory($category)) {
            return null;
        }

        $values = [
            'user_id' => $recipient->id,
            'actor_id' => $attributes['actor_id'] ?? null,
            'beneficiary_id' => $attributes['beneficiary_id'] ?? null,
            'monitoring_record_id' => $attributes['monitoring_record_id'] ?? null,
            'type' => $type,
            'category' => $category,
            'priority' => (string) ($attributes['priority'] ?? UserNotification::priorityFor($type)),
            'title' => $attributes['title'],
            'message' => $attributes['message'],
            'link' => $attributes['link'] ?? null,
            'dedupe_key' => $attributes['dedupe_key'] ?? null,
        ];

        // Event callers normally fire once, but an offline replay or retry can
        // call the same path twice. A supplied dedupe key makes that a no-op
        // instead of a duplicate row.
        if ($values['dedupe_key'] !== null) {
            return UserNotification::firstOrCreate(
                ['dedupe_key' => $values['dedupe_key']],
                $values,
            );
        }

        return UserNotification::create($values);
    }

    /**
     * Idempotent write for the daily smart-alert scan. The scan re-derives the
     * same facts every day, so it must update-or-create against a stable key
     * and respect the same preference gates as ordinary events.
     */
    public function upsertSmart(array $attributes): ?UserNotification
    {
        $type = (string) $attributes['type'];
        $recipient = User::query()->find($attributes['user_id'] ?? null);

        if (! $recipient || ! $this->settings->notificationTypeEnabled($type)) {
            return null;
        }

        $category = UserNotification::categoryFor($type);

        if (! $recipient->wantsNotificationCategory($category)) {
            return null;
        }

        return UserNotification::updateOrCreate(
            ['dedupe_key' => $attributes['dedupe_key']],
            [
                'user_id' => $recipient->id,
                'beneficiary_id' => $attributes['beneficiary_id'] ?? null,
                'monitoring_record_id' => $attributes['monitoring_record_id'] ?? null,
                'type' => $type,
                'category' => $category,
                'priority' => UserNotification::priorityFor($type),
                'title' => $attributes['title'],
                'message' => $attributes['message'],
                'link' => $attributes['link'] ?? null,
            ],
        );
    }

    /**
     * The caller's category switches, with missing keys defaulting to on.
     *
     * @return array<string, bool>
     */
    public function preferences(User $user): array
    {
        $stored = $user->notification_preferences ?? [];

        return collect(UserNotification::CATEGORY_LABELS)
            ->mapWithKeys(fn (string $label, string $category): array => [
                $category => (bool) ($stored[$category] ?? true),
            ])
            ->all();
    }

    /**
     * Persist a subset of category switches. Unknown keys are ignored rather
     * than stored, so a client cannot grow the preferences blob arbitrarily.
     *
     * @param  array<string, mixed>  $preferences
     * @return array<string, bool>
     */
    public function updatePreferences(User $user, array $preferences): array
    {
        $current = $this->preferences($user);

        foreach (UserNotification::CATEGORIES as $category) {
            if (array_key_exists($category, $preferences)) {
                $current[$category] = (bool) $preferences[$category];
            }
        }

        // Quietly: a preference change is not a user-record event and should
        // not create an audit row just because it lives on the user row.
        $user->forceFill(['notification_preferences' => $current])->saveQuietly();

        return $current;
    }

    /**
     * The recipient's unread stored-event count — the bell badge number.
     * Archived rows are excluded: they have been deliberately put aside.
     */
    public function unreadCount(User $user): int
    {
        return UserNotification::query()
            ->where('user_id', $user->id)
            ->whereNull('archived_at')
            ->whereNull('read_at')
            ->count();
    }

    /**
     * Mark every active stored notification read for this user.
     */
    public function markAllRead(User $user): int
    {
        return UserNotification::query()
            ->where('user_id', $user->id)
            ->whereNull('archived_at')
            ->whereNull('read_at')
            ->update(['read_at' => now()]);
    }

    /**
     * Mark one stored notification read for this user. Scoped to the caller's
     * own rows, so an id that belongs to someone else cannot be probed.
     */
    public function markRead(User $user, int $id): bool
    {
        $notification = UserNotification::query()
            ->where('user_id', $user->id)
            ->find($id);

        if ($notification === null) {
            return false;
        }

        $notification->markRead();

        return true;
    }

    /**
     * Apply one action to a selected set of the caller's own notifications.
     * This is the single bulk endpoint — mark read/unread, archive/unarchive,
     * or delete. Ids from other users are silently outside the query.
     *
     * @param  list<int>  $ids
     */
    public function bulk(User $user, array $ids, string $action): int
    {
        if ($ids === []) {
            return 0;
        }

        $query = UserNotification::query()
            ->where('user_id', $user->id)
            ->whereIn('id', $ids);

        return match ($action) {
            'read' => $query->whereNull('read_at')->update(['read_at' => now()]),
            'unread' => $query->whereNotNull('read_at')->update(['read_at' => null]),
            'archive' => $query->whereNull('archived_at')->update([
                'archived_at' => now(),
                'read_at' => now(),
            ]),
            'unarchive' => $query->whereNotNull('archived_at')->update(['archived_at' => null]),
            'delete' => $query->delete(),
            default => 0,
        };
    }

    /**
     * The role-scoped feed, most needing action first.
     *
     * Stored events and derived alerts merge so one screen and the header bell
     * remain one source of truth. Filters are applied to stored rows in SQL;
     * the bounded derived set is filtered in memory using the same normalized
     * criteria.
     *
     * @param  array<string, mixed>  $filters
     * @return array{alerts: list<array<string, mixed>>, counts: array<string, mixed>}
     */
    public function feed(
        User $user,
        int $limit = self::DEFAULT_LIMIT,
        string $filter = self::FILTER_ALL,
        int $page = 1,
        array $filters = [],
    ): array {
        $this->truncated = false;
        $filters = $this->normaliseFilters($filters);
        $smartOnly = $filter === self::FILTER_SMART;

        $alerts = $this->storedAlerts($user, $smartOnly, $filters);

        // A read or archived view is about stored state; derived alerts have
        // no such state and would contradict the selected filter.
        if (! $smartOnly && ! in_array($filters['status'], [self::STATUS_READ, self::STATUS_ARCHIVED], true)) {
            $alerts = array_merge(
                $alerts,
                $this->filterDerived($this->vaccinationAlerts($user), $filters),
                $this->filterDerived($this->dispersalAlerts($user), $filters),
            );
        }

        $alerts = $this->orderByUrgency($alerts);

        $counts = [
            'total' => count($alerts),
            self::URGENCY_URGENT => 0,
            self::URGENCY_WARNING => 0,
            self::URGENCY_INFO => 0,
            'important' => 0,
            'unread_events' => $this->unreadCount($user),
            'read_events' => UserNotification::query()
                ->where('user_id', $user->id)
                ->whereNull('archived_at')
                ->whereNotNull('read_at')
                ->count(),
            'archived_events' => UserNotification::query()
                ->where('user_id', $user->id)
                ->whereNotNull('archived_at')
                ->count(),
            // The tab badge, independent of the active filter.
            'smart' => $this->smartCount($user),
        ];

        foreach ($alerts as $alert) {
            $counts[$alert['urgency']]++;

            if (in_array($alert['priority'] ?? UserNotification::PRIORITY_NORMAL, [
                UserNotification::PRIORITY_CRITICAL,
                UserNotification::PRIORITY_HIGH,
            ], true)) {
                $counts['important']++;
            }
        }

        $counts['truncated'] = $this->truncated;
        $counts['per_page'] = Pagination::perPage($limit);
        $counts['current_page'] = max(1, $page);
        $counts['last_page'] = max(1, (int) ceil($counts['total'] / $counts['per_page']));

        return [
            'alerts' => array_slice(
                $alerts,
                ($counts['current_page'] - 1) * $counts['per_page'],
                $counts['per_page'],
            ),
            'counts' => $counts,
        ];
    }

    /**
     * @param  array<string, mixed>  $filters
     * @return array{status: string, category: ?string, priority: ?string, search: string, from: ?string, to: ?string}
     */
    private function normaliseFilters(array $filters): array
    {
        $status = (string) ($filters['status'] ?? self::STATUS_ALL);
        $category = $filters['category'] ?? null;
        $priority = $filters['priority'] ?? null;

        return [
            'status' => in_array($status, self::STATUSES, true) ? $status : self::STATUS_ALL,
            'category' => in_array($category, UserNotification::CATEGORIES, true) ? $category : null,
            'priority' => in_array($priority, UserNotification::PRIORITIES, true) ? $priority : null,
            'search' => trim((string) ($filters['search'] ?? '')),
            'from' => $filters['from'] ?? null,
            'to' => $filters['to'] ?? null,
        ];
    }

    /**
     * The recipient's stored notifications, as feed alerts.
     *
     * @param  array<string, mixed>  $filters
     * @return list<array<string, mixed>>
     */
    private function storedAlerts(User $user, bool $smartOnly, array $filters): array
    {
        $query = $this->storedQuery($user, $smartOnly, $filters);
        $matching = (clone $query)->count();

        if ($matching > self::SCAN_CAP) {
            $this->truncated = true;
        }

        return $query
            ->limit(self::SCAN_CAP)
            ->get()
            ->map(function (UserNotification $notification) use ($user): array {
                $isSmart = in_array($notification->type, UserNotification::SMART_TYPES, true);
                $category = $notification->category ?: UserNotification::categoryFor($notification->type);
                $priority = $notification->priority ?: UserNotification::priorityFor($notification->type);

                return [
                    'id' => "event-{$notification->id}",
                    'type' => $notification->type,
                    'category' => $category,
                    'category_label' => UserNotification::CATEGORY_LABELS[$category] ?? 'System Updates',
                    'priority' => $priority,
                    'priority_label' => UserNotification::PRIORITY_LABELS[$priority] ?? 'Normal',
                    'is_smart' => $isSmart,
                    'urgency' => $isSmart || $priority === UserNotification::PRIORITY_CRITICAL
                        ? self::URGENCY_WARNING
                        : self::URGENCY_INFO,
                    'title' => $notification->title,
                    'message' => $notification->message,
                    'date' => $notification->created_at->toIso8601String(),
                    'created_at' => $notification->created_at->toIso8601String(),
                    'read' => $notification->read_at !== null,
                    'archived' => $notification->archived_at !== null,
                    'beneficiary_id' => $notification->beneficiary_id,
                    'monitoring_record_id' => $notification->monitoring_record_id,
                    'link' => $notification->link ?? "/dashboard/{$user->role}/monitoring",
                ];
            })
            ->all();
    }

    /**
     * @param  array<string, mixed>  $filters
     */
    private function storedQuery(User $user, bool $smartOnly, array $filters): Builder
    {
        $query = UserNotification::query()
            ->where('user_id', $user->id)
            ->orderByDesc('created_at')
            ->orderByDesc('id');

        if ($smartOnly) {
            $query->whereIn('type', UserNotification::SMART_TYPES);
        }

        match ($filters['status']) {
            self::STATUS_ARCHIVED => $query->whereNotNull('archived_at'),
            self::STATUS_UNREAD => $query->whereNull('archived_at')->whereNull('read_at'),
            self::STATUS_READ => $query->whereNull('archived_at')->whereNotNull('read_at'),
            default => $query->whereNull('archived_at'),
        };

        $query->when($filters['category'] !== null, fn (Builder $q) => $q->where('category', $filters['category']));
        $query->when($filters['priority'] !== null, fn (Builder $q) => $q->where('priority', $filters['priority']));

        if ($filters['search'] !== '') {
            $pattern = Like::contains($filters['search']);

            $query->where(function (Builder $group) use ($pattern): void {
                $group->whereRaw('LOWER(title) LIKE ?', [$pattern])
                    ->orWhereRaw('LOWER(message) LIKE ?', [$pattern])
                    ->orWhereRaw('LOWER(type) LIKE ?', [$pattern])
                    ->orWhereHas('actor', fn (Builder $actor) => $actor->whereRaw('LOWER(name) LIKE ?', [$pattern]))
                    ->orWhereHas('beneficiary', function (Builder $beneficiary) use ($pattern): void {
                        $beneficiary->where(function (Builder $identity) use ($pattern): void {
                            $identity->whereRaw('LOWER(name_of_farmer) LIKE ?', [$pattern])
                                ->orWhereRaw("LOWER(COALESCE(rsbsa_number, '')) LIKE ?", [$pattern])
                                ->orWhereRaw("LOWER(COALESCE(ear_tag_number, '')) LIKE ?", [$pattern]);
                        });
                    });
            });
        }

        $query->when($filters['from'] !== null, fn (Builder $q) => $q->whereDate('created_at', '>=', $filters['from']));
        $query->when($filters['to'] !== null, fn (Builder $q) => $q->whereDate('created_at', '<=', $filters['to']));

        return $query;
    }

    /**
     * @param  list<array<string, mixed>>  $alerts
     * @param  array<string, mixed>  $filters
     * @return list<array<string, mixed>>
     */
    private function filterDerived(array $alerts, array $filters): array
    {
        return array_values(array_filter(
            $alerts,
            fn (array $alert): bool => $this->matchesDerived($alert, $filters),
        ));
    }

    /**
     * @param  array<string, mixed>  $alert
     * @param  array<string, mixed>  $filters
     */
    private function matchesDerived(array $alert, array $filters): bool
    {
        if (in_array($filters['status'], [self::STATUS_READ, self::STATUS_ARCHIVED], true)) {
            return false;
        }

        if ($filters['category'] !== null && ($alert['category'] ?? null) !== $filters['category']) {
            return false;
        }

        if ($filters['priority'] !== null && ($alert['priority'] ?? null) !== $filters['priority']) {
            return false;
        }

        if ($filters['search'] !== '') {
            $haystack = mb_strtolower(implode(' ', [
                (string) ($alert['title'] ?? ''),
                (string) ($alert['message'] ?? ''),
                (string) ($alert['address'] ?? ''),
                (string) ($alert['animal_type'] ?? ''),
            ]));

            if (! str_contains($haystack, mb_strtolower($filters['search']))) {
                return false;
            }
        }

        $date = substr((string) ($alert['date'] ?? ''), 0, 10);

        if ($filters['from'] !== null && ($date === '' || $date < $filters['from'])) {
            return false;
        }

        if ($filters['to'] !== null && ($date === '' || $date > $filters['to'])) {
            return false;
        }

        return true;
    }

    /**
     * How many Smart Alerts this user currently holds — the tab badge.
     */
    public function smartCount(User $user): int
    {
        return UserNotification::query()
            ->where('user_id', $user->id)
            ->whereNull('archived_at')
            ->whereIn('type', UserNotification::SMART_TYPES)
            ->count();
    }

    /**
     * Band the feed by urgency, and order each band by what is actionable.
     *
     * @param  list<array<string, mixed>>  $alerts
     * @return list<array<string, mixed>>
     */
    private function orderByUrgency(array $alerts): array
    {
        $bands = [
            self::URGENCY_URGENT => 1,
            self::URGENCY_WARNING => 1,
            self::URGENCY_INFO => -1,
        ];

        $ordered = [];

        foreach ($bands as $urgency => $direction) {
            $band = array_values(array_filter($alerts, fn (array $a): bool => $a['urgency'] === $urgency));

            usort($band, fn (array $a, array $b): int => $direction * strcmp((string) $a['date'], (string) $b['date']));

            $ordered = array_merge($ordered, $band);
        }

        return $ordered;
    }

    /**
     * Overdue and due-soon animals.
     *
     * @return list<array<string, mixed>>
     */
    private function vaccinationAlerts(User $user): array
    {
        $bands = [
            VaccinationScheduleService::STATUS_OVERDUE => [self::TYPE_VACCINATION_OVERDUE, self::URGENCY_URGENT],
            VaccinationScheduleService::STATUS_DUE_SOON => [self::TYPE_VACCINATION_DUE_SOON, self::URGENCY_WARNING],
        ];

        $alerts = [];

        foreach ($bands as $status => [$type, $urgency]) {
            $paginator = $this->schedule->listFor($user, $status, self::SCAN_CAP);

            if ($paginator->total() > self::SCAN_CAP) {
                $this->truncated = true;
            }

            foreach ($paginator->items() as $animal) {
                $schedule = VaccinationScheduleService::scheduleFor($animal->last_vaccination_date);

                $alerts[] = $this->vaccinationAlert($animal, $type, $urgency, $schedule, $user);
            }
        }

        return $alerts;
    }

    /**
     * @param  array{last_vaccination_date: ?string, next_due_date: ?string, days_until_due: ?int, status: string}  $schedule
     * @return array<string, mixed>
     */
    private function vaccinationAlert(
        Beneficiary $animal,
        string $type,
        string $urgency,
        array $schedule,
        User $user,
    ): array {
        $message = match ($type) {
            self::TYPE_VACCINATION_OVERDUE => "{$this->animal($animal)} passed its vaccination due date.",
            self::TYPE_VACCINATION_DUE_SOON => "{$this->animal($animal)} is coming due for vaccination.",
        };

        return [
            'id' => "{$type}-{$animal->id}",
            'type' => $type,
            'category' => UserNotification::CATEGORY_MONITORING,
            'category_label' => UserNotification::CATEGORY_LABELS[UserNotification::CATEGORY_MONITORING],
            'priority' => $type === self::TYPE_VACCINATION_OVERDUE
                ? UserNotification::PRIORITY_CRITICAL
                : UserNotification::PRIORITY_HIGH,
            'priority_label' => $type === self::TYPE_VACCINATION_OVERDUE ? 'Critical' : 'High',
            'urgency' => $urgency,
            'title' => match ($type) {
                self::TYPE_VACCINATION_OVERDUE => 'Vaccination overdue',
                self::TYPE_VACCINATION_DUE_SOON => 'Vaccination due soon',
            },
            'message' => $message,
            'date' => $schedule['next_due_date'],
            'beneficiary_id' => $animal->id,
            'animal_type' => $animal->animal_type,
            'address' => $animal->address,
            'days_until_due' => $schedule['days_until_due'],
            'link' => $this->vaccinationLink($user),
        ];
    }

    /**
     * Dispersal movements city-wide — every staff role sees every movement.
     *
     * @return list<array<string, mixed>>
     */
    private function dispersalAlerts(User $user): array
    {
        $events = $this->dispersals->scopeQueryFor($user)
            ->with(['beneficiary', 'parentBeneficiary'])
            ->orderByDesc('date_dispersed')
            ->orderByDesc('id')
            ->limit(self::SCAN_CAP)
            ->get();

        if ($events->count() >= self::SCAN_CAP) {
            $this->truncated = true;
        }

        return $events->map(fn (DispersalEvent $event): array => $this->dispersalAlert($event, $user))->all();
    }

    /**
     * @return array<string, mixed>
     */
    private function dispersalAlert(DispersalEvent $event, User $user): array
    {
        $received = $event->beneficiary;
        $source = $event->parentBeneficiary;
        $isReDispersal = $event->dispersal_type === DispersalEvent::TYPE_RE_DISPERSAL;

        $animal = trim(sprintf(
            '%s%s',
            $received?->animal_type ?? 'Animal',
            $received?->sex ? " ({$received->sex})" : '',
        ));

        return [
            'id' => "{$event->dispersal_type}-{$event->id}",
            'type' => $isReDispersal ? self::TYPE_RE_DISPERSAL : self::TYPE_DISPERSAL,
            'category' => UserNotification::CATEGORY_DISPERSALS,
            'category_label' => UserNotification::CATEGORY_LABELS[UserNotification::CATEGORY_DISPERSALS],
            'priority' => UserNotification::PRIORITY_NORMAL,
            'priority_label' => 'Normal',
            'urgency' => self::URGENCY_INFO,
            'title' => $isReDispersal ? 'Re-dispersal recorded' : 'Animal dispersed',
            'message' => $isReDispersal
                ? "{$animal} from {$this->household($source)} went to {$this->household($received)}."
                : "{$animal} was released to {$this->household($received)}.",
            'date' => $event->date_dispersed?->toDateString(),
            'beneficiary_id' => $received?->id,
            'animal_type' => $received?->animal_type,
            'address' => $received?->address,
            'days_until_due' => null,
            'link' => $this->dispersalLink($user),
        ];
    }

    /** "Carabao (F) in Banay Banay" — the animal, not the household it belongs to. */
    private function animal(Beneficiary $animal): string
    {
        return trim(sprintf(
            '%s%s in %s',
            $animal->animal_type,
            $animal->sex ? " ({$animal->sex})" : '',
            $animal->address,
        ));
    }

    /** "Aling Nena in Banay Banay" */
    private function household(?Beneficiary $beneficiary): string
    {
        if (! $beneficiary) {
            return 'the City Veterinary Office';
        }

        return "{$beneficiary->name_of_farmer} in {$beneficiary->address}";
    }

    /** Vaccinations are read and recorded against an animal's monitoring record. */
    private function vaccinationLink(User $user): string
    {
        return "/dashboard/{$user->role}/monitoring";
    }

    /** Dispersal movements live on the dispersal map for every staff role. */
    private function dispersalLink(User $user): string
    {
        return "/dashboard/{$user->role}/map";
    }
}
