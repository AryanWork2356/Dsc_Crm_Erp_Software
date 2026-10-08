"use client";
import * as React from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";

type T = { id: number; kind: "success" | "error"; text: string };
const Ctx = React.createContext<{ success: (t: string) => void; error: (t: string) => void }>({
  success: () => {},
  error: () => {},
});

export const useToast = () => React.useContext(Ctx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<T[]>([]);
  const push = React.useCallback((kind: T["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, kind, text }]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);
  const api = React.useMemo(
    () => ({ success: (t: string) => push("success", t), error: (t: string) => push("error", t) }),
    [push],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="no-print pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              "pointer-events-auto flex items-start gap-3 rounded-lg border bg-white p-3 text-sm shadow-lg",
              t.kind === "success" ? "border-emerald-200" : "border-red-200",
            )}
          >
            {t.kind === "success" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            )}
            <span className="flex-1 text-slate-800">{t.text}</span>
            <button onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))} aria-label="Dismiss">
              <X className="h-4 w-4 text-slate-400" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
