import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { useAuth } from "../context/AuthContext";
import { getApiUrl } from "../api/client";

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [apiUrl, setApiUrl] = useState(getApiUrl());
  const [apiKey, setApiKey] = useState("dev-key");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setChecking(true);
    try {
      await axios.get(`${apiUrl.replace(/\/$/, "")}/health`);
      login(apiUrl.replace(/\/$/, ""), apiKey);
      navigate("/");
    } catch {
      setError("Could not reach that API URL. Is the backend running?");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm"
      >
        <h1 className="text-xl font-semibold text-slate-900">Voice Agent Console</h1>
        <p className="mt-1 text-sm text-slate-500">Connect to your backend API.</p>

        <label className="mt-6 block text-sm font-medium text-slate-700">
          API base URL
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="http://localhost:8000"
          />
        </label>

        <label className="mt-4 block text-sm font-medium text-slate-700">
          API key
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="dev-key"
          />
        </label>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={checking}
          className="mt-6 w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {checking ? "Connecting..." : "Connect"}
        </button>
      </form>
    </div>
  );
}
