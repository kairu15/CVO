<?php

namespace App\Http\Controllers;

use App\Http\Requests\StorePublicDocumentRequest;
use App\Models\PublicDocument;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Downloadable public documents behind the Transparency page.
 *
 * Public side (session-free, throttled): the metadata list and the download
 * stream — published rows only. Admin side (EnsureUserIsAdmin +
 * permission:manage_settings, re-checked by the FormRequest): upload and
 * delete. Files live on the private local disk; the download route is the
 * only door, so access stays controllable and auditable without any public
 * storage exposure.
 */
class PublicDocumentController extends Controller
{
    /**
     * Public: metadata for every published document, newest first.
     */
    public function index(): JsonResponse
    {
        $documents = PublicDocument::published()
            ->get()
            ->map($this->present(...))
            ->values();

        return response()->json(['data' => $documents]);
    }

    /**
     * Admin: every row, drafts included — the editor's list. Published rows
     * come first (newest first); drafts trail at the bottom, oldest first,
     * so nothing hides at the top of the list.
     */
    public function adminIndex(): JsonResponse
    {
        $documents = PublicDocument::query()
            ->orderByRaw('published_at IS NULL asc')
            ->orderByDesc('published_at')
            ->orderByDesc('id')
            ->get()
            ->map($this->present(...))
            ->values();

        return response()->json(['data' => $documents]);
    }

    /**
     * Public: stream one published document under its original name.
     */
    public function download(PublicDocument $document): StreamedResponse
    {
        abort_unless(
            $document->published_at !== null && $document->published_at->lte(now()),
            Response::HTTP_NOT_FOUND,
        );

        abort_unless(
            Storage::disk($document->disk)->exists($document->file_path),
            Response::HTTP_NOT_FOUND,
            'The document file is missing.',
        );

        return Storage::disk($document->disk)->download(
            $document->file_path,
            $document->original_name,
            ['Content-Type' => $document->mime],
        );
    }

    /**
     * Admin: upload a PDF. The file goes to the private local disk under a
     * hashed name; the row keeps the original name for the download.
     */
    public function store(StorePublicDocumentRequest $request): JsonResponse
    {
        $file = $request->file('file');

        $document = PublicDocument::create([
            'title' => $request->validated('title'),
            'description' => $request->validated('description'),
            'category' => $request->validated('category'),
            'disk' => 'local',
            'file_path' => $file->store('public-documents'),
            'original_name' => $file->getClientOriginalName(),
            'mime' => $file->getMimeType(),
            'size_bytes' => $file->getSize(),
            'published_at' => $request->boolean('published') ? now() : null,
        ]);

        return response()->json(['data' => $document], Response::HTTP_CREATED);
    }

    /**
     * Admin: delete a document — the row AND its file. A dangling file with
     * no row would be un-deletable from the UI; a row pointing at a missing
     * file would 404 forever.
     */
    public function destroy(PublicDocument $document): JsonResponse
    {
        Storage::disk($document->disk)->delete($document->file_path);
        $document->delete();

        return response()->json([], Response::HTTP_NO_CONTENT);
    }

    /**
     * The metadata shape both audiences read. Drafts carry no download_url —
     * the public download route answers 404 for them by design, so an admin
     * "View" button that 404s must not exist either.
     *
     * @return array<string, mixed>
     */
    private function present(PublicDocument $document): array
    {
        return [
            'id' => $document->id,
            'title' => $document->title,
            'description' => $document->description,
            'category' => $document->category,
            'category_label' => $document->category_label,
            'original_name' => $document->original_name,
            'mime' => $document->mime,
            'size_bytes' => $document->size_bytes,
            'published_at' => $document->published_at?->toIso8601String(),
            'download_url' => $document->published_at !== null && $document->published_at->lte(now())
                ? '/api/v1/public/documents/' . $document->id . '/download'
                : null,
        ];
    }
}
