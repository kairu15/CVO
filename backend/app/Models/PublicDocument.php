<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

/**
 * One downloadable document on the public Transparency page.
 *
 * The file lives on the private local disk and streams through the download
 * route; this row is the metadata the public list reads. Categories are a
 * fixed vocabulary (CATEGORIES) so the transparency filter never needs a
 * lookup table — a new category is a code change, which is the right price
 * for a list this small.
 *
 * @property int $id
 * @property string $title
 * @property string|null $description
 * @property string $category
 * @property string $disk
 * @property string $file_path
 * @property string $original_name
 * @property string $mime
 * @property int $size_bytes
 * @property \Illuminate\Support\Carbon|null $published_at
 */
class PublicDocument extends Model
{
    use Auditable;

    public const CATEGORIES = [
        'annual_report' => 'Annual report',
        'accomplishment_report' => 'Accomplishment report',
        'budget' => 'Budget',
        'procurement' => 'Procurement',
        'other' => 'Other',
    ];

    protected $fillable = [
        'title',
        'description',
        'category',
        'disk',
        'file_path',
        'original_name',
        'mime',
        'size_bytes',
        'published_at',
    ];

    protected function casts(): array
    {
        return [
            'size_bytes' => 'integer',
            'published_at' => 'datetime',
        ];
    }

    /** Human-readable label for the category key. */
    public function getCategoryLabelAttribute(): string
    {
        return self::CATEGORIES[$this->category] ?? 'Other';
    }

    /**
     * Public documents: published only, newest first.
     */
    public function scopePublished($query)
    {
        return $query
            ->whereNotNull('published_at')
            ->where('published_at', '<=', now())
            ->orderByDesc('published_at')
            ->orderByDesc('id');
    }
}
