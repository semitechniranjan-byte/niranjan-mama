import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listAnalyzeJobs, startAnalyzeJob } from "../api/endpoints";

export function Analytics() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [executionId, setExecutionId] = useState(searchParams.get("execution_id") ?? "");
  const [parallelCount, setParallelCount] = useState(10);

  const { data: jobs } = useQuery({
    queryKey: ["analyze-jobs"],
    queryFn: listAnalyzeJobs,
    refetchInterval: 5_000,
  });

  const startMutation = useMutation({
    mutationFn: () => startAnalyzeJob(executionId, parallelCount),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["analyze-jobs"] }),
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (executionId.trim()) startMutation.mutate();
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Analytics</h1>

      <form
        onSubmit={handleSubmit}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <label className="text-xs font-medium text-slate-600">
          Execution ID
          <input
            value={executionId}
            onChange={(e) => setExecutionId(e.target.value)}
            className="mt-1 block rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs font-medium text-slate-600">
          Parallel count
          <input
            type="number"
            min={1}
            max={500}
            value={parallelCount}
            onChange={(e) => setParallelCount(Number(e.target.value))}
            className="mt-1 block w-28 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={startMutation.isPending}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Start analysis job
        </button>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Jobs</h2>
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="py-1">Job</th>
              <th className="py-1">Execution</th>
              <th className="py-1">Status</th>
              <th className="py-1">Progress</th>
            </tr>
          </thead>
          <tbody>
            {(jobs ?? []).map((job) => (
              <tr key={job.job_id} className="border-t border-slate-100">
                <td className="py-2 font-mono text-xs">{job.job_id.slice(-8)}</td>
                <td className="py-2">{job.execution_id}</td>
                <td className="py-2">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{job.status}</span>
                </td>
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full bg-indigo-600"
                        style={{ width: `${job.percentage}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-500">
                      {job.processed}/{job.total}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
            {(jobs ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-center text-slate-400">
                  No analysis jobs yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
