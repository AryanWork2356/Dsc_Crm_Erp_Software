import { cn, humanize } from "@/lib/utils";

const TONES = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  purple: "bg-violet-50 text-violet-700 ring-violet-200",
  teal: "bg-teal-50 text-teal-700 ring-teal-200",
} as const;
export type Tone = keyof typeof TONES;

// One shared map so every status looks the same everywhere in the app.
const STATUS_TONE: Record<string, Tone> = {
  APPROVED: "green", ACCEPTED: "green", WON: "green", PAID: "green", COMPLETED: "green", RECEIVED: "green",
  RESOLVED: "green", CLOSED: "slate", PRESENT: "green", ACTIVE: "green",
  IN_PROGRESS: "blue", EXECUTION: "blue", SENT: "blue", SENT_TO_VENDOR: "blue", ASSIGNED: "blue",
  CONTACTED: "blue", QUALIFIED: "blue", VIEWED: "blue", DESIGN: "purple", PLANNING: "slate",
  PROCUREMENT: "teal", QUALITY_CHECK: "purple", SNAGGING: "amber", HANDOVER: "teal",
  PENDING: "amber", PENDING_APPROVAL: "amber", NEGOTIATION: "amber", PARTIALLY_PAID: "amber",
  PARTIALLY_RECEIVED: "amber", WAITING: "amber", ON_HOLD: "amber", HALF_DAY: "amber", UNPAID: "amber",
  SITE_VISIT_SCHEDULED: "purple", SITE_VISIT_COMPLETED: "purple", PROPOSAL_IN_PROGRESS: "purple",
  QUOTATION_SENT: "blue", QUOTATION: "blue", NEW: "blue", OPEN: "blue", TODO: "slate", DRAFT: "slate",
  REJECTED: "red", LOST: "red", CANCELLED: "red", OVERDUE: "red", EXPIRED: "red", ABSENT: "red",
  BLOCKED: "red", URGENT: "red", HIGH: "amber", MEDIUM: "slate", LOW: "slate", LEAVE: "purple",
  OVERTIME: "teal",
};

export function Badge({ tone, className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        TONES[tone ?? "slate"],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "slate"}>{humanize(status)}</Badge>;
}
