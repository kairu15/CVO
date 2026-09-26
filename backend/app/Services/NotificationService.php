<?php

namespace App\Services;

use App\Models\Beneficiary;
use App\Models\DispersalEvent;
use App\Models\User;
use App\Models\UserNotification;

/**
 * Notifications — a derived, read-only feed.
 *
 * Deliberately NOT a table, and deliberately with no read/unread state. Every
 * alert here restates something already recorded: a dispersal event, or a
 * vaccination derived from the visit log. A `notifications` table would be a
 * second copy of those facts, free to drift the moment a record is corrected —
 * the same reasoning that made Vaccination Schedule and Animal Health derived
 * views rather than stored ones.
 *
 * The alert ids are therefore stable but not meaningful: they are built from
 * the type and the record they restate, so the same underlying record always
 * produces the same id. That matters because the header bell and this page
 * read the same feed — one source, two presentations, so they cannot
 * disagree about what has happened. It also means a `read_at` column is
 * impossible without a real table; if per-user read state is ever wanted, that
 * is the point at which this stops being derived and becomes data.
 *
 * Alerts are worded from the record's point of view, never the reader's: an
 * animal "was released to" a household rather than "you received". The feed is
 * built for one user's own rows, but the same alert must not become a lie when
 * an all-access admin reads it.
 */
class NotificationService
{
    public const TYPE_DISPERSAL = 'dispersal';

    public const TYPE_RE_DISPERSAL = 're-dispersal';

    public const TYPE_VACCINATION_OVERDUE = 'vaccination-overdue';

    public const TYPE_VACCINATION_DUE_SOON = 'vaccination-due-soon';

    /**
     * The alert vocabulary, for validation and for the frontend's icon map.
     *
     * Every alert is either an event that happened (a dispersal) or a date that
     * arrived (a vaccination falling due). An animal that has never been
     * vaccinated is deliberately NOT here: that is a standing state, not an
     * event, and it is true of every animal from the day it is registered. It
     * would fire for the whole program at once and swamp the urgent band with
     * animals nothing has happened to yet — which is precisely how a
     * notification badge stops meaning anything.
     *
     * "Which animals lack a vaccination" is still answered, on the two screens
     * built for it: the vaccination schedule lists never-vaccinated animals
     * first, and the animal health rollup flags them.
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

    public const DEFAULT_LIMIT = 20;

    /**
     * How many records of each kind are scanned per request.
     *
     * The feed is a recent window, not a full export, so the scan is bounded
     * rather than unbounded. When it is hit, `truncated` says so — a feed that
     * silently drops alerts is worse than one that admits it did.
     */
    public const SCAN_CAP = 50;

    /** Set while building the feed when a scan hit its cap. */
    private bool $truncated = false;

    public function __construct(
        private readonly VaccinationScheduleService $schedule,
        private readonly DispersalEventService $dispersals,
    ) {}

    /**
     * Record an event notification for a user at the moment it happens.
     *
     * This is the stored half of the module: the derived feed (vaccination /
     * dispersal) recomputes from records, but events like "a farmer
     * registered" have no record to re-derive from — they must be written
     * here, once, with read state, or they never existed.
     */
    public function create(User $recipient, array $attributes): UserNotification
    {
        return UserNotification::create([
            'user_id' => $recipient->id,
            'actor_id' => $attributes['actor_id'] ?? null,
            'beneficiary_id' => $attributes['beneficiary_id'] ?? null,
            'monitoring_record_id' => $attributes['monitoring_record_id'] ?? null,
            'type' => $attributes['type'],
            'title' => $attributes['title'],
            'message' => $attributes['message'],
            'link' => $attributes['link'] ?? null,
        ]);
    }

    /**
     * The recipient's unread stored-event count — the bell badge number.
     * Deliberately a plain COUNT of unread rows: cheap enough to poll.
     */
    public function unreadCount(User $user): int
    {
        return UserNotification::query()
            ->where('user_id', $user->id)
            ->whereNull('read_at')
            ->count();
    }

    /**
     * Mark every unread stored notification read for this user — the bell
     * panel's "mark all read". Returns how many rows changed.
     */
    public function markAllRead(User $user): int
    {
        return UserNotification::query()
            ->where('user_id', $user->id)
            ->whereNull('read_at')
            ->update(['read_at' => now()]);
    }

    /**
     * The role-scoped feed, most needing action first.
     *
     * Stored event notifications (this module's write half) merge with the
     * derived alerts (vaccination / dispersal): events lead — they are the
     * newest facts — then the derived bands follow in urgency order.
     *
     * @return array{alerts: list<array<string, mixed>>, counts: array<string, mixed>}
     */
    public function feed(User $user, int $limit = self::DEFAULT_LIMIT): array
    {
        // Reset per call: the flag is set while scanning, and a service
        // instance reused across calls must not inherit the previous answer.
        $this->truncated = false;

        $alerts = array_merge(
            $this->storedAlerts($user),
            $this->vaccinationAlerts($user),
            $this->dispersalAlerts($user),
        );

        $alerts = $this->orderByUrgency($alerts);

        $counts = [
            'total' => count($alerts),
            self::URGENCY_URGENT => 0,
            self::URGENCY_WARNING => 0,
            self::URGENCY_INFO => 0,
            'unread_events' => $this->unreadCount($user),
        ];

        foreach ($alerts as $alert) {
            $counts[$alert['urgency']]++;
        }

        $counts['truncated'] = $this->truncated;

        return [
            'alerts' => array_slice($alerts, 0, $limit),
            'counts' => $counts,
        ];
    }

    /**
     * The recipient's stored event notifications, as feed alerts. Events are
     * informational (they happened), never urgent — urgency in this module
     * means "a date has arrived", and an event's date has already passed.
     *
     * @return list<array<string, mixed>>
     */
    private function storedAlerts(User $user): array
    {
        return UserNotification::query()
            ->where('user_id', $user->id)
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->limit(self::SCAN_CAP)
            ->get()
            ->map(fn (UserNotification $notification): array => [
                'id' => "event-{$notification->id}",
                'type' => $notification->type,
                'urgency' => self::URGENCY_INFO,
                'title' => $notification->title,
                'message' => $notification->message,
                'date' => $notification->created_at->toIso8601String(),
                'created_at' => $notification->created_at->toIso8601String(),
                'read' => $notification->read_at !== null,
                'beneficiary_id' => $notification->beneficiary_id,
                'monitoring_record_id' => $notification->monitoring_record_id,
                'link' => $notification->link ?? "/dashboard/{$user->role}/monitoring",
            ])
            ->all();
    }

    /**
     * Band the feed by urgency, and order each band by what is actionable.
     *
     * Each band sorts on its own terms rather than sharing one comparator, which
     * is what makes "most needing action first" true at both scales:
     *
     * - urgent/warning — ascending, so the worst-overdue animal leads and the
     *   soonest due date leads. This matches the vaccination schedule's own
     *   ordering, which a vet already reads as worst-first.
     * - info — descending, so the newest movement leads.
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

            // A movement with no recorded date sorts last in its band, which is
            // right: it is the one alert with no date to act on.
            usort($band, fn (array $a, array $b): int => $direction * strcmp((string) $a['date'], (string) $b['date']));

            $ordered = array_merge($ordered, $band);
        }

        return $ordered;
    }

    /**
     * Overdue and due-soon animals.
     *
     * Reads the schedule service rather than re-deriving the cycle: the
     * overdue/due-soon boundary is defined once, in `applyStatusFilter`, and a
     * second copy here would eventually disagree with the schedule page about
     * which animals are late.
     *
     * `total()` is the exact number of matching animals, so the counts stay
     * right even when the scanned page is capped.
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
        // No default arm: an unknown type here is a bug, and `match` throws
        // rather than quietly wording an alert as the wrong thing.
        $message = match ($type) {
            self::TYPE_VACCINATION_OVERDUE => "{$this->animal($animal)} passed its vaccination due date.",
            self::TYPE_VACCINATION_DUE_SOON => "{$this->animal($animal)} is coming due for vaccination.",
        };

        return [
            'id' => "{$type}-{$animal->id}",
            'type' => $type,
            'urgency' => $urgency,
            'title' => match ($type) {
                self::TYPE_VACCINATION_OVERDUE => 'Vaccination overdue',
                self::TYPE_VACCINATION_DUE_SOON => 'Vaccination due soon',
            },
            // No dates in the prose: the row renders `date` through the same
            // formatter as every other screen, so one alert never shows two
            // spellings of the same day.
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
     * Dispersal movements touching the animals this user can see.
     *
     * Scoping is `DispersalEventService`'s, so a farmer sees only movements of
     * their own animals and a technician only those of their assigned
     * beneficiaries.
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
            // An initial dispersal has no source household: the programme did.
            return 'the City Veterinary Office';
        }

        return "{$beneficiary->name_of_farmer} in {$beneficiary->address}";
    }

    /** Vaccinations are read and recorded against an animal's monitoring record. */
    private function vaccinationLink(User $user): string
    {
        return "/dashboard/{$user->role}/monitoring";
    }

    /**
     * Dispersal movements have two homes in the SPA: the farmer follows them on
     * Dispersal Status, every other role on the dispersal map.
     */
    private function dispersalLink(User $user): string
    {
        return $user->role === 'farmer'
            ? '/dashboard/farmer/dispersal-status'
            : "/dashboard/{$user->role}/map";
    }
}
