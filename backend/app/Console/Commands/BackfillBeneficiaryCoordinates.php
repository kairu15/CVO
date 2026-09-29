<?php

namespace App\Console\Commands;

use App\Models\Beneficiary;
use App\Support\Barangays;
use Illuminate\Console\Command;

/**
 * Fill in map coordinates for households that carry none, using the covered
 * barangay centre their address names.
 *
 * Rows can end up coordinate-less for two reasons: the address names no
 * covered barangay at all ('Unlisted', or a typo), or it names one in a
 * spelling the matcher did not know (a report sheet writing "Manduao" for
 * "Mandu-ao", or "Villasol" for "Villasol (Bato)"). Only the second group can
 * be rescued — and only the second group is touched here: the fix resolves the
 * address through Barangays::normalize(), so a name that still matches nothing
 * is left alone rather than guessed at.
 *
 * Same rule the Excel import uses when it creates a household, applied
 * retroactively to the rows imported before that rule was tolerant enough.
 * Idempotent: a household that already has a pin is never revisited.
 */
class BackfillBeneficiaryCoordinates extends Command
{
    protected $signature = 'beneficiaries:backfill-coordinates
                            {--dry-run : List the households that would be pinned without writing anything}';

    protected $description = 'Pin households whose address names a covered barangay but that carry no coordinates';

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');

        $rows = Beneficiary::query()
            ->where(function ($query): void {
                $query->whereNull('latitude')
                    ->orWhereNull('longitude')
                    ->orWhere('latitude', 0)
                    ->orWhere('longitude', 0);
            })
            ->orderBy('id')
            ->get();

        $pinned = 0;
        $unresolved = 0;

        foreach ($rows as $beneficiary) {
            $address = (string) $beneficiary->address;
            $center = $address === ''
                ? null
                : Barangays::centerFor(Barangays::normalize($address));

            if ($center === null) {
                $unresolved++;
                $this->line("  skip  #{$beneficiary->id} {$beneficiary->name_of_farmer} — \"{$address}\" names no covered barangay");

                continue;
            }

            $this->line(sprintf(
                '  %s  #%d %s — "%s" → %s (%s, %s)',
                $dryRun ? 'would pin' : 'pinned   ',
                $beneficiary->id,
                $beneficiary->name_of_farmer,
                $address,
                Barangays::normalize($address),
                $center[0],
                $center[1],
            ));

            if (! $dryRun) {
                $beneficiary->update([
                    'latitude' => $center[0],
                    'longitude' => $center[1],
                ]);
            }

            $pinned++;
        }

        $this->newLine();
        $this->info(sprintf(
            '%s %d household(s)%s; %d left coordinate-less.',
            $dryRun ? 'Would pin' : 'Pinned',
            $pinned,
            $dryRun ? ' (dry run — nothing written)' : '',
            $unresolved,
        ));

        return self::SUCCESS;
    }
}
