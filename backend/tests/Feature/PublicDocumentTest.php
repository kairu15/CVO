<?php

namespace Tests\Feature;

use App\Models\PublicDocument;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Public transparency documents: the public side sees metadata + a download
 * stream for published rows only; the admin side uploads PDFs to the private
 * disk and deletes row + file together. Access is gated to manage_settings.
 */
class PublicDocumentTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
    }

    /* ------------------------------------------------------------------ *
     |  Helpers                                                            |
     * ------------------------------------------------------------------ */

    private function admin(): User
    {
        return User::factory()->create(['role' => 'admin']);
    }

    private function technician(): User
    {
        return User::factory()->create(['role' => 'technician']);
    }

    private function pdf(string $name = 'annual-report.pdf'): UploadedFile
    {
        return UploadedFile::fake()->create($name, 120, 'application/pdf');
    }

    /* ------------------------------------------------------------------ *
     |  Upload + admin gate                                                |
     * ------------------------------------------------------------------ */

    public function test_admin_can_upload_a_published_pdf(): void
    {
        $admin = $this->admin();

        $response = $this->actingAs($admin)->post('/api/v1/admin/documents', [
            'title' => '2025 Annual Report',
            'description' => 'Full-year accomplishments of the office.',
            'category' => 'annual_report',
            'published' => true,
            'file' => $this->pdf(),
        ]);

        $response->assertCreated();
        $this->assertDatabaseCount('public_documents', 1);

        $document = PublicDocument::sole();
        $this->assertSame('2025 Annual Report', $document->title);
        $this->assertSame('annual_report', $document->category);
        $this->assertSame('application/pdf', $document->mime);
        $this->assertSame('annual-report.pdf', $document->original_name);
        $this->assertNotNull($document->published_at);
        Storage::disk('local')->assertExists($document->file_path);
    }

    public function test_upload_can_be_a_draft_that_the_public_never_sees(): void
    {
        $this->actingAs($this->admin())->post('/api/v1/admin/documents', [
            'title' => 'Draft disclosure',
            'category' => 'budget',
            'published' => false,
            'file' => $this->pdf(),
        ])->assertCreated();

        $this->getJson('/api/v1/public/documents')->assertJsonCount(0, 'data');
    }

    public function test_technician_cannot_upload_or_delete_documents(): void
    {
        $technician = $this->technician();

        $this->actingAs($technician)->post('/api/v1/admin/documents', [
            'title' => 'Nope',
            'category' => 'other',
            'file' => $this->pdf(),
        ])->assertForbidden();

        $document = PublicDocument::create([
            'title' => 'X',
            'category' => 'other',
            'disk' => 'local',
            'file_path' => 'public-documents/x.pdf',
            'original_name' => 'x.pdf',
            'mime' => 'application/pdf',
            'size_bytes' => 1,
            'published_at' => now(),
        ]);

        $this->actingAs($technician)->deleteJson("/api/v1/admin/documents/{$document->id}")
            ->assertForbidden();
    }

    public function test_admin_index_lists_drafts_the_public_cannot_see(): void
    {
        $admin = $this->admin();

        $this->actingAs($admin)->post('/api/v1/admin/documents', [
            'title' => 'Published disclosure',
            'category' => 'budget',
            'published' => true,
            'file' => $this->pdf('budget.pdf'),
        ])->assertCreated();

        $this->actingAs($admin)->post('/api/v1/admin/documents', [
            'title' => 'Draft disclosure',
            'category' => 'budget',
            'published' => false,
            'file' => $this->pdf('draft.pdf'),
        ])->assertCreated();

        // The admin list sees both, published first — a draft must never go
        // missing from the editor after a reload.
        $titles = collect($this->actingAs($admin)->getJson('/api/v1/admin/documents')
            ->assertOk()
            ->json('data'));

        $this->assertSame(
            ['Published disclosure', 'Draft disclosure'],
            $titles->pluck('title')->all(),
        );

        // The draft carries no download URL; the published row does.
        $this->assertNotNull($titles->firstWhere('title', 'Published disclosure')['download_url']);
        $this->assertNull($titles->firstWhere('title', 'Draft disclosure')['download_url']);

        // And the public index still shows only the published one.
        $this->getJson('/api/v1/public/documents')
            ->assertOk()
            ->assertJsonCount(1, 'data');
    }

    /* ------------------------------------------------------------------ *
     |  Validation                                                         |
     * ------------------------------------------------------------------ */

    public function test_upload_rejects_non_pdf_files(): void
    {
        $this->actingAs($this->admin())->post('/api/v1/admin/documents', [
            'title' => 'Not a PDF',
            'category' => 'other',
            'file' => UploadedFile::fake()->create('report.docx', 50),
        ])->assertStatus(422)->assertJsonValidationErrors(['file']);
    }

    public function test_upload_rejects_unknown_categories(): void
    {
        $this->actingAs($this->admin())->post('/api/v1/admin/documents', [
            'title' => 'Odd category',
            'category' => 'secret_stuff',
            'file' => $this->pdf(),
        ])->assertStatus(422)->assertJsonValidationErrors(['category']);
    }

    /* ------------------------------------------------------------------ *
     |  Public list + download                                             |
     * ------------------------------------------------------------------ */

    public function test_public_index_lists_published_documents_with_metadata(): void
    {
        $this->actingAs($this->admin())->post('/api/v1/admin/documents', [
            'title' => '2025 Annual Report',
            'description' => 'Full-year accomplishments.',
            'category' => 'annual_report',
            'published' => true,
            'file' => $this->pdf('annual-report.pdf'),
        ])->assertCreated();

        $response = $this->getJson('/api/v1/public/documents');

        $response->assertOk();
        $row = $response->json('data.0');
        $this->assertSame('2025 Annual Report', $row['title']);
        $this->assertSame('Annual report', $row['category_label']);
        $this->assertSame('annual-report.pdf', $row['original_name']);
        $this->assertGreaterThan(0, $row['size_bytes']);
        $this->assertStringContainsString('/download', $row['download_url']);

        // The raw file path and disk never leave the server.
        $this->assertStringNotContainsString('file_path', $response->getContent());
        $this->assertStringNotContainsString('public-documents', $response->getContent());
    }

    public function test_public_download_streams_the_file_under_its_original_name(): void
    {
        $this->actingAs($this->admin())->post('/api/v1/admin/documents', [
            'title' => '2025 Annual Report',
            'category' => 'annual_report',
            'published' => true,
            'file' => $this->pdf('annual-report.pdf'),
        ])->assertCreated();

        $document = PublicDocument::sole();

        $response = $this->get("/api/v1/public/documents/{$document->id}/download");

        $response->assertOk();
        $this->assertStringContainsString(
            'annual-report.pdf',
            (string) $response->headers->get('content-disposition'),
        );
        $this->assertSame('application/pdf', $response->headers->get('content-type'));
    }

    public function test_draft_documents_404_on_the_public_download_route(): void
    {
        $this->actingAs($this->admin())->post('/api/v1/admin/documents', [
            'title' => 'Draft',
            'category' => 'other',
            'published' => false,
            'file' => $this->pdf(),
        ])->assertCreated();

        $document = PublicDocument::sole();

        $this->get("/api/v1/public/documents/{$document->id}/download")
            ->assertNotFound();
    }

    /* ------------------------------------------------------------------ *
     |  Delete                                                             |
     * ------------------------------------------------------------------ */

    public function test_admin_delete_removes_both_the_row_and_the_file(): void
    {
        $this->actingAs($this->admin())->post('/api/v1/admin/documents', [
            'title' => 'To delete',
            'category' => 'procurement',
            'published' => true,
            'file' => $this->pdf(),
        ])->assertCreated();

        $document = PublicDocument::sole();
        $path = $document->file_path;
        Storage::disk('local')->assertExists($path);

        $this->actingAs($this->admin())->deleteJson("/api/v1/admin/documents/{$document->id}")
            ->assertNoContent();

        $this->assertDatabaseMissing('public_documents', ['id' => $document->id]);
        Storage::disk('local')->assertMissing($path);
    }
}
