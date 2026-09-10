import { useCallback, useEffect, useState } from "react";
import { projectsApi } from "../api/projectsApi";
import { getErrorMessage } from "../api/client";
import { LoadingSpinner } from "../components/LoadingSpinner";

const STATUS_STYLES = {
  planning: "bg-amber-100 text-amber-800",
  active: "bg-green-100 text-green-800",
  completed: "bg-blue-100 text-blue-800",
  archived: "bg-slate-200 text-slate-600",
};

const STATUSES = Object.keys(STATUS_STYLES);

export default function DashboardPage() {
  const [projects, setProjects] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ name: "", description: "", status: "planning" });
  const [submitting, setSubmitting] = useState(false);
  const [page, setPage] = useState(1);

  const load = useCallback(async (pageToLoad = page) => {
    setLoading(true);
    try {
      const res = await projectsApi.list(pageToLoad);
      setProjects(res.data.data);
      setMeta(res.data.meta ?? null);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load(page);
  }, [load, page]);

  async function handleCreate(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await projectsApi.create(form);
      setForm({ name: "", description: "", status: "planning" });
      await load(1);
      setPage(1);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStatusChange(project, status) {
    setProjects((prev) =>
      prev.map((p) => (p.id === project.id ? { ...p, status } : p)),
    );
    try {
      await projectsApi.update(project.id, { status });
    } catch {
      await load();
    }
  }

  async function handleDelete(project) {
    try {
      await projectsApi.remove(project.id);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  if (loading && projects.length === 0) return <LoadingSpinner />;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Projects</h1>
        <p className="mt-1 text-sm text-slate-600">
          Full CRUD against the protected Laravel API.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <form
        onSubmit={handleCreate}
        className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-[1fr_2fr_auto_auto]"
      >
        <input
          type="text"
          required
          placeholder="Project name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="rounded-md border border-slate-300 px-3 py-2"
        />
        <input
          type="text"
          placeholder="Description (optional)"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="rounded-md border border-slate-300 px-3 py-2"
        />
        <select
          value={form.status}
          onChange={(e) => setForm({ ...form, status: e.target.value })}
          className="rounded-md border border-slate-300 px-3 py-2"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? "Adding…" : "Add project"}
        </button>
      </form>

      <ul className="space-y-3">
        {projects.map((project) => (
          <li
            key={project.id}
            className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">{project.name}</h2>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[project.status] ?? "bg-slate-100"}`}>
                  {project.status}
                </span>
              </div>
              {project.description && (
                <p className="mt-0.5 text-sm text-slate-600">{project.description}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <select
                value={project.status}
                onChange={(e) => handleStatusChange(project, e.target.value)}
                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                aria-label={`Change status of ${project.name}`}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => handleDelete(project)}
                className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
        {projects.length === 0 && !loading && (
          <li className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
            No projects yet — add your first one above.
          </li>
        )}
      </ul>

      {meta && meta.last_page > 1 && (
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-slate-600">
            Page {meta.current_page} of {meta.last_page}
          </span>
          <button
            type="button"
            disabled={page >= meta.last_page}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
