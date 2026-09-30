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

    public const TYPE_REGISTRATION_NEW = 'registration-new';

    public const TYPE_REGISTRATION_ACCEPTED = 'registration-accepted';

    public const TYPE_TECHNICIAN_ASSIGNED = 'technician-assigned';

    public const TYPE_TECHNICIAN_REASSIGNED = 'technician-reassigned';

    public const TYPE_FIELD_VISIT_PHOTO = 'field-visit-photo';

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

    /** Every Smart Alert type — the set the daily scan owns and reconciles. */
    public const SMART_TYPES = [
        self::TYPE_SMART_VACCINATION_OVERDUE,
        self::TYPE_SMART_BCS_OUT_OF_RANGE,
        self::TYPE_SMART_NO_RECENT_VISIT,
        self::TYPE_SMART_BARANGAY_FLAG,
    ];

    public const TYPES = [
        self::TYPE_REGISTRATION_NEW,
        self::TYPE_REGISTRATION_ACCEPTED,
        self::TYPE_TECHNICIAN_ASSIGNED,
        self::TYPE_TECHNICIAN_REASSIGNED,
        self::TYPE_FIELD_VISIT_PHOTO,
        ...self::SMART_TYPES,
    ];

    protected $fillable = [
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
    ];

    protected function casts(): array
    {
        return [
            'read_at' => 'datetime',
        ];
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

    public function markRead(): void
    {
        if ($this->read_at === null) {
            $this->update(['read_at' => now()]);
        }
    }
}
