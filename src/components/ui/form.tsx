import * as React from "react";
import { cn } from "@/lib/utils";
import { SpeakButton } from "@/components/forms/speak-button";

const base =
  "w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-slate-50 disabled:text-slate-500";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...p }, ref) => <input ref={ref} className={cn(base, "h-10", className)} {...p} />,
);
Input.displayName = "Input";

/** Every notes box has a microphone: people can speak instead of typing (`noMic` to leave it out). */
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { noMic?: boolean }>(
  ({ className, noMic, ...p }, ref) => {
    const box = <textarea ref={ref} rows={3} className={cn(base, "py-2", !noMic && "pb-9", className)} {...p} />;
    if (noMic || p.readOnly || p.disabled) return box;
    return <span className={cn("relative block w-full", className?.includes("flex-1") && "min-w-0 flex-1")}>{box}<SpeakButton /></span>;
  },
);
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...p }, ref) => (
    <select ref={ref} className={cn(base, "h-10 pr-8", className)} {...p}>
      {children}
    </select>
  ),
);
Select.displayName = "Select";

export function Field({
  label,
  error,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
      {hint && !error && <span className="block text-xs text-slate-500">{hint}</span>}
      {error && <span className="block text-xs font-medium text-red-600">{error}</span>}
    </label>
  );
}
