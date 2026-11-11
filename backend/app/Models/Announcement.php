<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

/**
 * One veterinary announcement on the public landing page.
 *
 * Drafts (published_at null) are admin-only; the public index serves only
 * published rows, pinned ones first. See AnnouncementController for the two
 * audiences.
 *
 * @property int $id
 * @property string $title
 * @property string $body
 * @property bool $is_pinned
 * @property \Illuminate\Support\Carbon|null $published_at
 */
class Announcement extends Model
{
    use Auditable;

    protected $fillable = [
        'title',
        'body',
        'is_pinned',
        'published_at',
    ];

    protected function casts(): array
    {
        return [
            'is_pinned' => 'boolean',
            'published_at' => 'datetime',
        ];
    }

    /**
     * Public announcements: published only, pinned first, newest first.
     */
    public function scopePublished($query)
    {
        return $query
            ->whereNotNull('published_at')
            ->where('published_at', '<=', now())
            ->orderByDesc('is_pinned')
            ->orderByDesc('published_at')
            ->orderByDesc('id');
    }
}
