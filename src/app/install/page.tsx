import Image from "next/image";
import Link from "next/link";
import { InstallPanel } from "@/components/layout/pwa";

export const metadata = { title: "Install the app" };

const ADDRESS = "app.dscinterior.co.in";

/** Public page (no sign-in needed): one link to give everybody, for Android, iPhone and computers. */
export default function InstallPage() {
  return (
    <main className="min-h-screen bg-[#361210] px-4 py-8">
      <div className="mx-auto w-full max-w-md">
        <Image src="/brand/dsc-logo.png" alt="DSC Interior" width={952} height={450} priority className="mx-auto h-auto w-64" />
        <div className="mt-6 rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
          <h1 className="font-serif text-2xl font-semibold tracking-tight text-brand-900">Install the DSC app</h1>
          <p className="mt-1 text-sm text-slate-500">One minute, once. After this the app updates by itself.</p>
          <div className="mt-4 h-0.5 w-12 rounded bg-accent" />
          <div className="mt-5"><InstallPanel address={ADDRESS} /></div>
          <p className="mt-6 text-center text-sm"><Link href="/login" className="font-medium text-brand-700 hover:underline">Go to sign in</Link></p>
        </div>
        <p className="mt-4 text-center text-xs text-amber-100/70">{ADDRESS}</p>
      </div>
    </main>
  );
}
