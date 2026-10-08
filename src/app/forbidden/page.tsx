import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export const metadata = { title: "No access" };

export default function Forbidden() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <ShieldAlert className="h-10 w-10 text-amber-500" />
      <h1 className="text-xl font-semibold text-slate-900">You don&apos;t have access to this page</h1>
      <p className="max-w-sm text-sm text-slate-500">If you think you should, ask the Owner or Admin to update your role.</p>
      <Link href="/" className="mt-2 text-sm font-medium text-brand-700 hover:underline">
        Go to my home
      </Link>
    </main>
  );
}
