<?php

namespace App\Services;

use App\Models\Project;
use App\Models\User;
use App\Support\Pagination;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;

class ProjectService
{
    /**
     * List the user's projects, newest first.
     */
    public function listFor(User $user, int $perPage = Pagination::DEFAULT_PER_PAGE): LengthAwarePaginator
    {
        return $user->projects()->latest()->paginate($perPage);
    }

    /**
     * Create a project owned by the given user.
     */
    public function create(User $user, array $data): Project
    {
        return $user->projects()->create($data);
    }

    /**
     * Update a project.
     */
    public function update(Project $project, array $data): Project
    {
        $project->update($data);

        return $project->refresh();
    }

    /**
     * Delete a project.
     */
    public function delete(Project $project): void
    {
        $project->delete();
    }
}
