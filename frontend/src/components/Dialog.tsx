/**
 * In-app replacements for window.prompt and window.confirm.
 *
 * The native dialogs are drawn by the browser, not by us: they announce themselves as
 * "www.qsilon.com says", ignore the product styling entirely, and look like a phishing
 * warning in front of a client. They also block the whole tab while they are open.
 *
 * The API is promise-based so a call site reads almost the same as the one it replaces:
 *
 *   const name = await dialog.prompt("New template name");
 *   if (await dialog.confirm(`Delete "${t.name}"?`, { danger: true })) ...
 *
 * Both resolve to null / false when dismissed, exactly as the native ones do.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

type PromptOptions = {
  body?: string;
  defaultValue?: string;
  placeholder?: string;
  okLabel?: string;
};

type ConfirmOptions = {
  body?: string;
  okLabel?: string;
  /** Colours the confirming button red, for anything that destroys something. */
  danger?: boolean;
};

interface DialogApi {
  prompt: (title: string, options?: PromptOptions) => Promise<string | null>;
  confirm: (title: string, options?: ConfirmOptions) => Promise<boolean>;
}

type Pending =
  | { kind: "prompt"; title: string; options: PromptOptions; resolve: (v: string | null) => void }
  | { kind: "confirm"; title: string; options: ConfirmOptions; resolve: (v: boolean) => void };

const DialogContext = createContext<DialogApi | undefined>(undefined);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const prompt = useCallback(
    (title: string, options: PromptOptions = {}) =>
      new Promise<string | null>((resolve) => {
        setValue(options.defaultValue ?? "");
        setPending({ kind: "prompt", title, options, resolve });
      }),
    [],
  );

  const confirm = useCallback(
    (title: string, options: ConfirmOptions = {}) =>
      new Promise<boolean>((resolve) => {
        setPending({ kind: "confirm", title, options, resolve });
      }),
    [],
  );

  const close = useCallback(
    (accepted: boolean) => {
      setPending((current) => {
        if (!current) return null;
        if (current.kind === "prompt") current.resolve(accepted ? value : null);
        else current.resolve(accepted);
        return null;
      });
    },
    [value],
  );

  // Escape should dismiss, the same way the native dialog does.
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, close]);

  useEffect(() => {
    if (pending?.kind === "prompt") inputRef.current?.focus();
  }, [pending]);

  const isPrompt = pending?.kind === "prompt";
  const danger = pending?.kind === "confirm" && pending.options.danger;
  const okLabel = pending?.options.okLabel ?? (isPrompt ? "Save" : danger ? "Delete" : "Confirm");
  const canSubmit = !isPrompt || value.trim().length > 0;

  return (
    <DialogContext.Provider value={{ prompt, confirm }}>
      {children}
      {pending && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[1px]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
          >
            <h2 className="text-sm font-semibold text-slate-900">{pending.title}</h2>
            {pending.options.body && (
              <p className="mt-1 text-xs text-slate-500">{pending.options.body}</p>
            )}

            {isPrompt && (
              <input
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSubmit) close(true);
                }}
                placeholder={pending.options.placeholder}
                className="mt-3 h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => close(false)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => close(true)}
                disabled={!canSubmit}
                className={`rounded-lg px-3.5 py-1.5 text-xs font-medium text-white transition disabled:opacity-40 ${
                  danger ? "bg-rose-600 hover:bg-rose-700" : "bg-indigo-600 hover:bg-indigo-700"
                }`}
              >
                {okLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialog must be used within DialogProvider");
  return ctx;
}
