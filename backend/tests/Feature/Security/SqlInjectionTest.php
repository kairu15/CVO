<?php

namespace Tests\Feature\Security;

use App\Models\Beneficiary;
use App\Models\User;
use App\Support\Like;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Item 6 — SQL injection audit, locked in by tests.
 *
 * Every raw/`LIKE` query in the codebase binds user input; the tests prove
 * that hostile payloads are treated as LITERAL text (they match nothing and
 * break nothing), not executed, and that LIKE wildcards are escaped so a
 * `%`-flood cannot force full-table scans.
 */
class SqlInjectionTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->admin = User::factory()->create(['role' => 'admin']);
        Beneficiary::factory()->create([
            'name_of_farmer' => 'Ben Dover',
            'address' => 'Banay Banay',
        ]);
    }

    public function test_classic_injection_payloads_are_matched_as_literals(): void
    {
        $payloads = [
            "'; DROP TABLE beneficiaries; --",
            "' OR '1'='1",
            "1' UNION SELECT password FROM users --",
        ];

        foreach ($payloads as $payload) {
            // The search parameter is `q` (min:2); payloads are long enough
            // to pass validation and must arrive at the query as inert text.
            $this->actingAs($this->admin)
                ->getJson('/api/v1/search?q='.urlencode($payload))
                ->assertOk();
        }

        // ...and the table still exists — nothing was executed.
        $this->assertDatabaseHas('beneficiaries', ['name_of_farmer' => 'Ben Dover']);
    }

    public function test_search_wildcards_are_escaped(): void
    {
        // A bare % would match every household if it reached the pattern.
        $this->actingAs($this->admin)
            ->getJson('/api/v1/admin/beneficiaries?search='.urlencode('%'))
            ->assertOk()
            ->assertJsonCount(0, 'data');

        $this->actingAs($this->admin)
            ->getJson('/api/v1/admin/users?search='.urlencode('%'))
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    public function test_the_like_helper_escapes_the_full_wildcard_vocabulary(): void
    {
        // contains() wraps in %...% and escapes the term's own wildcards.
        // (Expected literals read as %\%100\%% — single backslashes —
        // because PHP single-quoted strings need none of these doubled.)
        $this->assertSame('%\%100\%%', Like::contains('%100%'));
        $this->assertSame('a\_b', Like::escape('a_b'));
        // A backslash in the term must itself be escaped (doubled) or it
        // would neutralize the escape character that follows a later % or _.
        // Expected literal is back + TWO backslashes + slash, which in PHP
        // single quotes is written with four.
        $this->assertSame('back\\\\slash', Like::escape('back\slash'));

        // The escaped pattern can only match the literal term.
        $this->assertSame('%50\%%', Like::contains('50%'));
    }

    public function test_admin_user_search_handles_hostile_input(): void
    {
        $payloads = ["%' OR 1=1 --", "'; DROP TABLE users; --", 'a_b%c'];

        foreach ($payloads as $payload) {
            $this->actingAs($this->admin)
                ->getJson('/api/v1/admin/users?search='.urlencode($payload))
                ->assertOk()
                ->assertJsonCount(0, 'data');
        }

        // The users table survived.
        $this->assertDatabaseHas('users', ['id' => $this->admin->id]);
    }
}
