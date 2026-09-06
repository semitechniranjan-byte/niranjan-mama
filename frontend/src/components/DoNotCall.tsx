/**
 * The do-not-call list.
 *
 * Numbers land here two ways. Some are put here by hand or loaded from a client's own
 * register; the rest the agent adds itself when a call ends somewhere there is no coming
 * back from - a wrong number, a bereavement, a legal threat. Every dial checks this list
 * first, whichever way the call was started, because ringing one of these people again is
 * the kind of mistake a client hears about from their customer rather than from us.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addSuppression,
  importSuppressions,
  listSuppressions,
  removeSuppression,
} from "../api/endpoints";
import { IconTrash, IconUpload } from "./Icons";

export function DoNotCall() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [number, setNumber] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const { data } = useQuery({ queryKey: ["suppressions"], queryFn: () => listSuppressions(200) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["suppressions"] });

  const fail = (err: unknown) => {
    const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
    setNote(detail || (err as Error).message);
  };

  const add = useMutation({
    mutationFn: () => addSuppression(number, reason),
    onSuccess: () => {
      setNote(`${number} will not be called again.`);
      setNumber("");
      setReason("");
      refresh();
    },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: removeSuppression,
    onSuccess: () => {
      setNote("Removed — that number can be called again.");
      refresh();
    },
    onError: fail,
  });

  const load = useMutation({
    mutationFn: importSuppressions,
    onSuccess: (res) => {
      setNote(
        `Read ${res.read} rows, added ${res.added}.` +
          (res.no_number_found ? ` ${res.no_number_found} had no number in them.` : "") +
          ` ${res.total} on the list now.`,
      );
      refresh();
    },
    onError: fail,
    onSettled: () => {
      if (fileRef.current) fileRef.current.value = "";
    },
  });

  const rows = data?.suppressions ?? [];

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Do not call</h3>
          <p className="text-xs text-slate-400">
            {data?.total ?? 0} number{data?.total === 1 ? "" : "s"} that no call will reach —
            by hand, from a client register, or added by the agent after a wrong number, a
            bereavement or a legal threat.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xlsm"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) load.mutate(f);
            }}
            className="hidden"
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={load.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
          >
            <IconUpload size={13} />
            {load.isPending ? "Loading…" : "Import a list"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 bg-slate-50/60 px-5 py-3">
        <label className="text-xs font-medium text-slate-600">
          Number
          <input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="+91 62995 15059"
            className="mt-1 block h-9 w-48 rounded-lg border border-slate-300 px-2.5 text-sm"
          />
        </label>
        <label className="min-w-0 flex-1 text-xs font-medium text-slate-600">
          Why
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Asked not to be called"
            className="mt-1 block h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm"
          />
        </label>
        <button
          onClick={() => add.mutate()}
          disabled={!number.trim() || add.isPending}
          className="h-9 rounded-lg bg-indigo-600 px-3.5 text-xs font-medium text-white transition hover:bg-indigo-700 disabled:opacity-40"
        >
          Add
        </button>
      </div>

      {note && <p className="border-b border-slate-100 px-5 py-2 text-xs text-slate-500">{note}</p>}

      <div className="max-h-72 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="px-5 py-6 text-center text-xs text-slate-400">
            Nothing on the list. Every number can be called.
          </p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 border-b border-slate-100 bg-white text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2 font-semibold">Number</th>
                <th className="px-3 py-2 font-semibold">Why</th>
                <th className="px-3 py-2 font-semibold">Added</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((s) => (
                <tr key={s.phone_number} className="hover:bg-slate-50/60">
                  <td className="px-5 py-2 font-mono text-slate-800">{s.phone_number}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {s.reason || "—"}
                    {s.source === "automatic" && (
                      <span className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
                        by the agent
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-400">
                    {s.added_at ? new Date(s.added_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-5 py-2 text-right">
                    <button
                      onClick={() => remove.mutate(s.phone_number)}
                      title="Allow calls to this number again"
                      className="rounded p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-500"
                    >
                      <IconTrash size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
