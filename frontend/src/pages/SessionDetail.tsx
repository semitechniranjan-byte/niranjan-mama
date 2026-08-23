import { useMemo, useState } from "react";
import { DispositionBadge, maskPhone } from "../components/Disposition";
import { useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  endSession,
  getDispositions,
  getSession,
  getSessionMessages,
  sendSessionMessage,
  updateSessionConfig,
} from "../api/endpoints";

export function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const sessionId = id!;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: dispositions } = useQuery({ queryKey: ["dispositions"], queryFn: getDispositions });
  const labels = useMemo(
    () => Object.fromEntries((dispositions ?? []).map((d) => [d.value, d.label])),
    [dispositions],
  );

  const { data: session } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => getSession(sessionId),
  });
  const { data: messages, refetch: refetchMessages } = useQuery({
    queryKey: ["session-messages", sessionId],
    queryFn: () => getSessionMessages(sessionId),
  });

  // model_data holds the post-call analysis. It was written on every call and shown
  // on none of them.
  const analysis = (session?.model_data ?? {}) as Record<string, unknown>;

  const [systemPrompt, setSystemPrompt] = useState("");
  const [testMessage, setTestMessage] = useState("");

  const savePromptMutation = useMutation({
    mutationFn: () => updateSessionConfig(sessionId, { system_prompt: systemPrompt }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["session", sessionId] }),
  });

  const sendMessageMutation = useMutation({
    mutationFn: () => sendSessionMessage(sessionId, testMessage),
    onSuccess: () => {
      setTestMessage("");
      refetchMessages();
    },
  });

  const endSessionMutation = useMutation({
    mutationFn: () => endSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1 text-sm text-slate-500 transition hover:text-indigo-600"
          >
            &larr; Back
          </button>
          {/* The number and the outcome are what someone opens this page for; the raw
              session id is plumbing and belongs underneath. */}
          <h1 className="mt-1 font-mono text-xl font-semibold text-slate-900">
            {maskPhone(session?.phone_number)}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {session?.active ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                On call
              </span>
            ) : (
              <DispositionBadge
                code={session?.disposition_code}
                label={session?.disposition_code ? labels[session.disposition_code] : undefined}
              />
            )}
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
              {session?.direction ?? "-"}
            </span>
            <span className="font-mono text-[11px] text-slate-400" title={sessionId}>
              {sessionId?.slice(-8)}
            </span>
          </div>
        </div>
        <button
          onClick={() => endSessionMutation.mutate()}
          disabled={endSessionMutation.isPending || session?.status === "completed"}
          className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          End session
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Transcript</h2>
              <span className="text-xs text-slate-400">
                {(messages ?? []).length} turn{(messages ?? []).length === 1 ? "" : "s"}
              </span>
            </div>
            {/* Chat layout: the agent on the left, the customer on the right, so the
                back-and-forth reads at a glance instead of as one column of blocks. */}
            <div className="mt-3 max-h-[30rem] space-y-3 overflow-y-auto pr-1">
              {(messages ?? []).map((m, idx) => {
                const isBot = m.role === "assistant";
                return (
                  <div key={m._id ?? idx} className={`flex ${isBot ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[78%] ${isBot ? "" : "text-right"}`}>
                      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                        {isBot ? "Roshini" : "Customer"}
                      </div>
                      <div
                        className={`inline-block rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                          isBot
                            ? "rounded-tl-sm bg-indigo-50 text-slate-800 ring-1 ring-indigo-100"
                            : "rounded-tr-sm bg-slate-800 text-white"
                        }`}
                      >
                        {m.content}
                      </div>
                    </div>
                  </div>
                );
              })}
              {(messages ?? []).length === 0 && (
                <p className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
                  No conversation recorded for this call.
                </p>
              )}
            </div>
            <form
              className="mt-4 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (testMessage.trim()) sendMessageMutation.mutate();
              }}
            >
              <input
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
                placeholder="Send a test user message"
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={sendMessageMutation.isPending}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Send
              </button>
            </form>
          </div>
        </div>

        <div className="space-y-4">
          {/* Call outcome: the analysis result, which was being written to the session and
              then never shown anywhere. This is the answer a collections client wants. */}
          {analysis && Object.keys(analysis).length > 0 && (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-900">Call outcome</h2>
              </div>
              <dl className="divide-y divide-slate-100 text-sm">
                {([
                  ["Disposition", session?.disposition_code
                    ? `${session.disposition_code}${labels[session.disposition_code] ? ` — ${labels[session.disposition_code]}` : ""}`
                    : null],
                  ["Promise date", analysis.ptp_date],
                  ["Days to pay", analysis.ptp_days],
                  ["Amount discussed", analysis.amount],
                  ["Cooperation", analysis.cooperation],
                  ["Interruptions", session?.interruption_count],
                ] as [string, unknown][])
                  .filter(([, v]) => v !== null && v !== undefined && v !== "")
                  .map(([k, v]) => (
                    <div key={k} className="flex items-start justify-between gap-4 px-4 py-2.5">
                      <dt className="shrink-0 text-slate-500">{k}</dt>
                      <dd className="text-right font-medium text-slate-800">{String(v)}</dd>
                    </div>
                  ))}
              </dl>
              {typeof analysis.customer_said === "string" && analysis.customer_said && (
                <div className="border-t border-slate-100 px-4 py-3">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    What the customer said
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-slate-700">
                    {String(analysis.customer_said)}
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Session info</h2>
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Status</dt>
                <dd>{session?.status}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Direction</dt>
                <dd>{session?.direction}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Phone</dt>
                <dd>{session?.phone_number || "-"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Created</dt>
                <dd>{session?.created_at ? new Date(session.created_at).toLocaleString() : "-"}</dd>
              </div>
            </dl>
          </div>

          {session?.recording_url && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Recording</h2>
              <audio controls src={session.recording_url} className="mt-2 w-full" />
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">System prompt</h2>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder={session?.system_prompt || "You are a helpful voice assistant."}
              rows={5}
              className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              onClick={() => savePromptMutation.mutate()}
              disabled={savePromptMutation.isPending || !systemPrompt.trim()}
              className="mt-2 w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Save prompt
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
