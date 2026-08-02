import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  endSession,
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

  const { data: session } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => getSession(sessionId),
  });
  const { data: messages, refetch: refetchMessages } = useQuery({
    queryKey: ["session-messages", sessionId],
    queryFn: () => getSessionMessages(sessionId),
  });

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
      <div className="flex items-center justify-between">
        <div>
          <button onClick={() => navigate(-1)} className="text-sm text-slate-500 hover:underline">
            Back
          </button>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">{sessionId}</h1>
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
            <h2 className="text-sm font-semibold text-slate-900">Transcript</h2>
            <div className="mt-3 max-h-96 space-y-2 overflow-y-auto">
              {(messages ?? []).map((m, idx) => (
                <div
                  key={m._id ?? idx}
                  className={`rounded-md px-3 py-2 text-sm ${
                    m.role === "user" ? "bg-slate-100 text-slate-800" : "bg-indigo-600 text-white ml-8"
                  }`}
                >
                  <div className="text-xs opacity-60">{m.role}</div>
                  {m.content}
                </div>
              ))}
              {(messages ?? []).length === 0 && (
                <p className="text-sm text-slate-400">No messages yet.</p>
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
