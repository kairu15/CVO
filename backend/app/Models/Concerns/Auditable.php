<?php

namespace App\Models\Concerns;

use App\Models\ActivityLog;
use App\Services\AuditLogger;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

/**
 * One audit row per model change, written inside the transaction that made
 * the change (App\Services\AuditLogger rethrows while a transaction is open,
 * so a rolled-back change leaves no row and a committed change always has
 * one).
 *
 * Why a trait and not an observer class: the behaviour travels with the model
 * — a model that can be written must be auditable, and forgetting to register
 * an observer would silently drop coverage. Applied to the records the audit
 * spec calls out (beneficiaries/animals, dispersal events, monitoring records,
 * technician assignments, users, animal types and classifications).
 *
 * What it stores: ONLY the fields that changed (old + new), with secrets
 * replaced by a marker and identifiers masked through
 * App\Support\SensitiveMask. Rows written before this trait existed keep NULL
 * values — the diff columns are additive.
 *
 * Two escape hatches exist for flows that already log their own richer row
 * (the MOA flip, an invite): `skipNextAudit()` on the instance and
 * `auditNextCreatedAs()` before a create. Each is one-shot, so a forgotten
 * call cannot keep suppressing rows.
 */
trait Auditable
{
    /**
     * Fields whose VALUE is never written to the trail. The key is kept
     * (so a password change still reads as a password change) with a marker
     * in place of the value.
     *
     * @var list<string>
     */
    public const AUDIT_HIDDEN_FIELDS = [
        'password',
        'remember_token',
    ];

    /**
     * Fields describing the ROW's own bookkeeping rather than the change —
     * including deleted_at, because a soft delete and a restore are already
     * described by their own event name.
     *
     * @var list<string>
     */
    public const AUDIT_NOISE_FIELDS = [
        'created_at',
        'updated_at',
        'deleted_at',
    ];

    /** What stands in for a hidden field's value — the key survives, the secret does not. */
    public const AUDIT_HIDDEN_VALUE = '[hidden]';

    /** One-shot action substitution for the next created row of this class. */
    protected static ?string $auditNextCreatedAction = null;

    /** One-shot context merged into the next created row of this class. */
    protected static ?array $auditNextCreatedContext = null;

    /** One-shot instance flag: skip the next audit event this row would write. */
    public bool $skipNextAuditChange = false;

    public static function bootAuditable(): void
    {
        static::created(static function (Model $model): void {
            $model->auditModelChange('created');
        });

        static::updated(static function (Model $model): void {
            $model->auditModelChange('updated');
        });

        static::deleted(static function (Model $model): void {
            $model->auditModelChange('deleted');
        });

        // `restored()` is defined by SoftDeletes only. Calling it on a model
        // without the trait falls through Model::__callStatic, which CONSTRUCTS
        // a model — while that model is still booting, tripping the framework's
        // "may not be called while it is being booted" guard.
        if (method_exists(static::class, 'restored')) {
            static::restored(static function (Model $model): void {
                $model->auditModelChange('restored');
            });
        }
    }

    /**
     * Substitute the action of the NEXT create on this model class — for a
     * record whose business meaning differs from the plain verb (an invite
     * logged as `user_invited` rather than `user_created`).
     *
     * Must be called immediately before the create: a create that never
     * happens leaves the override for the next one.
     *
     * @param  array<string, mixed>  $context
     */
    public static function auditNextCreatedAs(string $action, array $context = []): void
    {
        static::$auditNextCreatedAction = $action;
        static::$auditNextCreatedContext = $context;
    }

    /**
     * Suppress the next audit event for THIS row only — for a change that has
     * a richer manual row of its own, so the trail keeps exactly one entry.
     */
    public function skipNextAudit(): static
    {
        $this->skipNextAuditChange = true;

        return $this;
    }

    /**
     * Write the row for one model event.
     *
     * @param  string  $event  created | updated | deleted | restored
     */
    protected function auditModelChange(string $event): void
    {
        if ($this->skipNextAuditChange) {
            $this->skipNextAuditChange = false;

            return;
        }

        [$oldValues, $newValues] = match ($event) {
            'created' => [[], $this->auditAttributes()],
            'updated' => $this->auditAttributeDiff(),
            'deleted' => [$this->auditAttributes(), []],
            'restored' => [[], $this->auditAttributes()],
            default => [[], []],
        };

        // An update that only touched bookkeeping (e.g. a restore rewriting
        // deleted_at) is already described by the dedicated event.
        if ($event === 'updated' && $oldValues === [] && $newValues === []) {
            return;
        }

        $action = $this->auditActionFor($event, $oldValues, $newValues);
        $context = $this->auditContextFor($event, $oldValues, $newValues);

        if ($event === 'created' && static::$auditNextCreatedAction !== null) {
            $action = static::$auditNextCreatedAction;
            $context = array_merge(static::$auditNextCreatedContext ?? [], $context);
            static::$auditNextCreatedAction = null;
            static::$auditNextCreatedContext = null;
        }

        if ($action === null) {
            return;
        }

        app(AuditLogger::class)->log(
            auth()->user(),
            $action,
            $this,
            $context,
            $oldValues === [] ? null : $oldValues,
            $newValues === [] ? null : $newValues,
        );
    }

    /**
     * Every stored attribute of the row (create / delete / restore payloads),
     * minus bookkeeping fields, with secret values replaced.
     *
     * @return array<string, mixed>
     */
    protected function auditAttributes(): array
    {
        $values = [];

        foreach ($this->getAttributes() as $key => $value) {
            if (in_array($key, self::AUDIT_NOISE_FIELDS, true)) {
                continue;
            }

            $values[$key] = in_array($key, self::AUDIT_HIDDEN_FIELDS, true)
                ? self::AUDIT_HIDDEN_VALUE
                : $value;
        }

        return $values;
    }

    /**
     * Only the fields this update actually changed, each paired with the
     * value it replaced.
     *
     * @return array{0: array<string, mixed>, 1: array<string, mixed>}
     */
    protected function auditAttributeDiff(): array
    {
        $old = [];
        $new = [];

        // getChanges() is already populated by the time `updated` fires, and
        // getRawOriginal() still holds the pre-save values (Eloquent syncs
        // them only after `saved`).
        foreach ($this->getChanges() as $key => $value) {
            if (in_array($key, self::AUDIT_NOISE_FIELDS, true)) {
                continue;
            }

            if (in_array($key, self::AUDIT_HIDDEN_FIELDS, true)) {
                $old[$key] = self::AUDIT_HIDDEN_VALUE;
                $new[$key] = self::AUDIT_HIDDEN_VALUE;

                continue;
            }

            $old[$key] = $this->getRawOriginal($key);
            $new[$key] = $value;
        }

        return [$old, $new];
    }

    /**
     * The stored action: the model's bespoke name when the vocabulary has one
     * (`beneficiary_updated`), else the generic verb (`created`).
     *
     * Overridden by models whose events need their own vocabulary (users,
     * technician assignments); overrides should finish with
     * `resolveAuditAction()`.
     */
    protected function auditActionFor(string $event, array $oldValues, array $newValues): ?string
    {
        return $this->resolveAuditAction($event, $oldValues, $newValues);
    }

    /**
     * The default naming rule: `<model key>_<event>` when the vocabulary has
     * that action, otherwise the bare event verb.
     */
    protected function resolveAuditAction(string $event, array $oldValues, array $newValues): ?string
    {
        $bespoke = $this->auditKey().'_'.$event;

        if (in_array($bespoke, ActivityLog::ACTIONS, true)) {
            return $bespoke;
        }

        return in_array($event, ActivityLog::ACTIONS, true) ? $event : null;
    }

    /**
     * Extra structured details for the row (e.g. the previous/new role a role
     * change carries for the account activity modal).
     *
     * @param  array<string, mixed>  $oldValues
     * @param  array<string, mixed>  $newValues
     * @return array<string, mixed>
     */
    protected function auditContextFor(string $event, array $oldValues, array $newValues): array
    {
        return [];
    }

    /** Short action prefix: 'beneficiary', 'user', 'animal_type'… */
    protected function auditKey(): string
    {
        return Str::snake(class_basename(static::class));
    }
}
