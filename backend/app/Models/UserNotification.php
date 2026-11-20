<?php

namespace App\Models;

use Database\Factories\UserNotificationFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * One stored event notification for one recipient.
 *
 * Created by the backend at the moment the event happens (registration,
 * acceptance, assignment, field-visit photo) — never derived, never faked on
 * the client. Read state lives here, which is what makes the bell badge
 * real: unread_count() is a COUNT, not a guess.
 *
 * @property int $id
 * @property int $user_id
 * @property int|null $actor_id
 * @property int|null $beneficiary_id
 * @property int|null $monitoring_record_id
 * @property string $type
 * @property string $title
 * @property string $message
 * @property string|null $link
 * @property string|null $dedupe_key
 * @property Carbon|null $read_at
 * @property Carbon $created_at
 */
class UserNotification extends Model
{
    /** @use HasFactory<UserNotificationFactory> */
    use HasFactory;

    /*
     * The category is the stable product vocabulary the Notifications screen
     * groups by. It is stored beside the type so filtering never has to load
     * every row and re-derive the same map in PHP.
     */
    public const CATEGORY_BENEFICIARIES = 'beneficiaries';

    public const CATEGORY_DISPERSALS = 'dispersals';

    public const CATEGORY_FIELD_VISITS = 'field_visits';

    public const CATEGORY_MONITORING = 'monitoring';

    public const CATEGORY_TECHNICIANS = 'technicians';

    public const CATEGORY_SYSTEM = 'system';

    public const CATEGORY_SECURITY = 'security';

    /** @var array<string, string> */
    public const CATEGORY_LABELS = [
        self::CATEGORY_BENEFICIARIES => 'Beneficiaries',
        self::CATEGORY_DISPERSALS => 'Dispersals',
        self::CATEGORY_FIELD_VISITS => 'Field Visits',
        self::CATEGORY_MONITORING => 'Monitoring',
        self::CATEGORY_TECHNICIANS => 'Technicians',
        self::CATEGORY_SYSTEM => 'System Updates',
        self::CATEGORY_SECURITY => 'Security Alerts',
    ];

    /** @var list<string> */
    public const CATEGORIES = [
        self::CATEGORY_BENEFICIARIES,
        self::CATEGORY_DISPERSALS,
        self::CATEGORY_FIELD_VISITS,
        self::CATEGORY_MONITORING,
        self::CATEGORY_TECHNICIANS,
        self::CATEGORY_SYSTEM,
        self::CATEGORY_SECURITY,
    ];

    public const PRIORITY_CRITICAL = 'critical';

    public const PRIORITY_HIGH = 'high';

    public const PRIORITY_NORMAL = 'normal';

    public const PRIORITY_LOW = 'low';

    /** @var array<string, string> */
    public const PRIORITY_LABELS = [
        self::PRIORITY_CRITICAL => 'Critical',
        self::PRIORITY_HIGH => 'High',
        self::PRIORITY_NORMAL => 'Normal',
        self::PRIORITY_LOW => 'Low',
    ];

    /** @var list<string> */
    public const PRIORITIES = [
        self::PRIORITY_CRITICAL,
        self::PRIORITY_HIGH,
        self::PRIORITY_NORMAL,
        self::PRIORITY_LOW,
    ];

    /**
     * An administrator enrolled a beneficiary. This replaced the old
     * `registration-new` event when public self-registration was removed —
     * historical rows may still carry that string, which is why the column is
     * a plain string rather than an enum.
     */
    public const TYPE_BENEFICIARY_ADDED = 'beneficiary-added';

    public const TYPE_TECHNICIAN_ASSIGNED = 'technician-assigned';

    public const TYPE_TECHNICIAN_REASSIGNED = 'technician-reassigned';

    public const TYPE_FIELD_VISIT_PHOTO = 'field-visit-photo';

    public const TYPE_FIELD_VISIT_COMPLETED = 'field-visit-completed';

    /*
     * Ownership-chain events. Unlike the derived dispersal feed (which
     * restates the beneficiary pass-on table on read), an animal handover has
     * no row anything else re-derives from, so each one is WRITTEN here, once,
     * to the technicians assigned to the old and new holders and to admins.
     */
    public const TYPE_ANIMAL_DISPERSED = 'animal-dispersed';

    public const TYPE_ANIMAL_RE_DISPERSED = 'animal-re-dispersed';

    public const TYPE_ANIMAL_RETURNED = 'animal-returned';

    public const TYPE_ANIMAL_EVENT_VOIDED = 'animal-event-voided';

    /*
     * Smart Alerts — the daily, rule-based flags written by
     * SmartAlertService. Deliberately a separate namespace of types so the
     * UI can pull them into their own "Flagged" tab and the scan's own
     * rows can be reconciled (updated or cleared) without touching the
     * ordinary event notifications above.
     */
    public const TYPE_SMART_VACCINATION_OVERDUE = 'smart-vaccination-overdue';

    public const TYPE_SMART_BCS_OUT_OF_RANGE = 'smart-bcs-out-of-range';

    public const TYPE_SMART_NO_RECENT_VISIT = 'smart-no-recent-visit';

    public const TYPE_SMART_BARANGAY_FLAG = 'smart-barangay-flag';

    public const TYPE_CLUSTER_ALERT = 'cluster-alert';

    /** Every Smart Alert type — the set the daily scan owns and reconciles. */
    public const SMART_TYPES = [
        self::TYPE_SMART_VACCINATION_OVERDUE,
        self::TYPE_SMART_BCS_OUT_OF_RANGE,
        self::TYPE_SMART_NO_RECENT_VISIT,
        self::TYPE_SMART_BARANGAY_FLAG,
    ];

    public const TYPES = [
        self::TYPE_BENEFICIARY_ADDED,
        self::TYPE_TECHNICIAN_ASSIGNED,
        self::TYPE_TECHNICIAN_REASSIGNED,
        self::TYPE_FIELD_VISIT_PHOTO,
        self::TYPE_FIELD_VISIT_COMPLETED,
        self::TYPE_ANIMAL_DISPERSED,
        self::TYPE_ANIMAL_RE_DISPERSED,
        self::TYPE_ANIMAL_RETURNED,
        self::TYPE_ANIMAL_EVENT_VOIDED,
        ...self::SMART_TYPES,
        self::TYPE_CLUSTER_ALERT,
    ];

    /**
     * Category + default priority for every stored type. `cluster-alert` is
     * reserved for the security category even though the cluster scan has its
     * own future delivery path; the map keeps the vocabulary in one place.
     *
     * @var array<string, array{0: string, 1: string}>
     */
    public const TYPE_META = [
        self::TYPE_BENEFICIARY_ADDED => [self::CATEGORY_BENEFICIARIES, self::PRIORITY_NORMAL],
        self::TYPE_TECHNICIAN_ASSIGNED => [self::CATEGORY_TECHNICIANS, self::PRIORITY_HIGH],
        self::TYPE_TECHNICIAN_REASSIGNED => [self::CATEGORY_TECHNICIANS, self::PRIORITY_HIGH],
        self::TYPE_FIELD_VISIT_PHOTO => [self::CATEGORY_FIELD_VISITS, self::PRIORITY_NORMAL],
        self::TYPE_FIELD_VISIT_COMPLETED => [self::CATEGORY_FIELD_VISITS, self::PRIORITY_NORMAL],
        self::TYPE_ANIMAL_DISPERSED => [self::CATEGORY_DISPERSALS, self::PRIORITY_NORMAL],
        self::TYPE_ANIMAL_RE_DISPERSED => [self::CATEGORY_DISPERSALS, self::PRIORITY_NORMAL],
        self::TYPE_ANIMAL_RETURNED => [self::CATEGORY_DISPERSALS, self::PRIORITY_NORMAL],
        self::TYPE_ANIMAL_EVENT_VOIDED => [self::CATEGORY_DISPERSALS, self::PRIORITY_HIGH],
        self::TYPE_SMART_VACCINATION_OVERDUE => [self::CATEGORY_MONITORING, self::PRIORITY_CRITICAL],
        self::TYPE_SMART_BCS_OUT_OF_RANGE => [self::CATEGORY_MONITORING, self::PRIORITY_HIGH],
        self::TYPE_SMART_NO_RECENT_VISIT => [self::CATEGORY_FIELD_VISITS, self::PRIORITY_HIGH],
        self::TYPE_SMART_BARANGAY_FLAG => [self::CATEGORY_MONITORING, self::PRIORITY_HIGH],
        self::TYPE_CLUSTER_ALERT => [self::CATEGORY_SECURITY, self::PRIORITY_CRITICAL],
    ];

    protected $fillable = [
        'category',
        'priority',
        'user_id',
        'actor_id',
        'beneficiary_id',
        'monitoring_record_id',
        'type',
        'title',
        'message',
        'link',
        'dedupe_key',
        'read_at',
        'archived_at',
    ];

    protected function casts(): array
    {
        return [
            'read_at' => 'datetime',
            'archived_at' => 'datetime',
        ];
    }

    /**
     * The single source for a type's category/priority fallback. Unknown types
     * stay visible under System Updates rather than disappearing from filters.
     *
     * @return array{0: string, 1: string}
     */
    public static function metaFor(string $type): array
    {
        return self::TYPE_META[$type] ?? [self::CATEGORY_SYSTEM, self::PRIORITY_NORMAL];
    }

    public static function categoryFor(string $type): string
    {
        return self::metaFor($type)[0];
    }

    public static function priorityFor(string $type): string
    {
        return self::metaFor($type)[1];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }

    public function beneficiary(): BelongsTo
    {
        return $this->belongsTo(Beneficiary::class);
    }

    /** Archived notifications stay queryable but leave the active inbox. */
    public function scopeActive($query)
    {
        return $query->whereNull('archived_at');
    }

    public function markRead(): void
    {
        if ($this->read_at === null) {
            $this->update(['read_at' => now()]);
        }
    }
}
