import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { useAuth } from "../context/AuthContext";
import { getApiUrl, type Role } from "../api/client";

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setChecking(true);
    try {
      const { data } = await axios.post(`${getApiUrl().replace(/\/$/, "")}/auth/login`, {
        email,
        password,
      });
      login(data.token, data.role as Role, data.email, data.pages);
      navigate("/");
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      setError(
        status === 401
          ? "Invalid email or password."
          : "Could not reach the server. Please try again.",
      );
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-800 p-8 shadow-xl"
      >
        <div className="mb-6">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-indigo-600 text-lg font-semibold text-white">
            Q
          </div>
          <h1 className="text-xl font-semibold text-white">Qsilon Voice Console</h1>
          <p className="mt-1 text-sm text-slate-400">Sign in to continue.</p>
        </div>

        <label className="block text-sm font-medium text-slate-300">
          Email
          <input
            type="email"
            autoComplete="username"
            required
            className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </label>

        <label className="mt-4 block text-sm font-medium text-slate-300">
          Password
          <div className="relative mt-1">
            <input
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 pr-16 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-slate-400 hover:text-slate-200"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        </label>

        {error && (
          <p className="mt-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
        )}

        <button
          type="submit"
          disabled={checking}
          className="mt-6 w-full rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
        >
          {checking ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
