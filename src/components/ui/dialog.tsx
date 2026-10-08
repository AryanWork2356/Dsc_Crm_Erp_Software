"use client";
import * as React from "react";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px]" />
        <D.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-1.5rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-white shadow-2xl focus:outline-none",
            wide ? "max-w-3xl" : "max-w-lg",
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
            <div>
              <D.Title className="text-base font-semibold text-slate-900">{title}</D.Title>
              <D.Description className={cn("mt-0.5 text-sm text-slate-500", !description && "sr-only")}>
                {description ?? title}
              </D.Description>
            </div>
            <D.Close className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
              <X className="h-5 w-5" />
            </D.Close>
          </div>
          <div className="p-5">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
