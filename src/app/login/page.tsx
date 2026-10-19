import { redirect } from "next/navigation";
import Image from "next/image";
import { ClipboardList, FileSpreadsheet, HardHat, ReceiptIndianRupee } from "lucide-react";
import { getCtx } from "@/lib/auth";
import { homeFor } from "@/lib/home";
import { LoginForm } from "./login-form";
import { LanguageSwitcher } from "@/components/layout/language";

export const metadata = { title: "Sign in" };

const POINTS = [
  { icon: FileSpreadsheet, text: "BOQ to quotation in minutes" },
  { icon: HardHat, text: "Daily site reports with photos" },
  { icon: ClipboardList, text: "Material, stock and approvals" },
  { icon: ReceiptIndianRupee, text: "Billing, payments and profit" },
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const c = await getCtx();
  if (c) redirect(homeFor(c.role));
  const { next } = await searchParams;

  return (
    <main className="relative min-h-screen bg-slate-50 lg:grid lg:grid-cols-[1.1fr_1fr]">
      {/* language: always top right */}
      <div className="absolute right-4 top-4 z-20">
        <LanguageSwitcher tone="auto" />
      </div>

      {/* hero */}
      <section className="relative isolate overflow-hidden bg-gradient-to-br from-brand-950 via-brand-900 to-brand-800 px-6 pb-24 pt-8 text-white lg:flex lg:min-h-screen lg:flex-col lg:justify-between lg:px-14 lg:pb-12 lg:pt-12">
        <div aria-hidden className="anim-float pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-accent/20 blur-3xl" />
        <div aria-hidden className="anim-float pointer-events-none absolute -bottom-32 -left-24 h-96 w-96 rounded-full bg-brand-500/20 blur-3xl [animation-delay:-6s]" />
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:44px_44px]" />

        <div className="anim-fade-up relative flex items-center gap-3">
          <Image src="/icons/icon-192.png" alt="DSC" width={48} height={48} priority className="h-12 w-12 rounded-xl shadow-lg ring-1 ring-white/20" />
          <div className="leading-tight">
            <p className="text-lg font-semibold tracking-wide">DSC Interior Pvt. Ltd.</p>
            <p className="text-xs text-brand-200">Thane · Mumbai</p>
          </div>
        </div>

        <div className="relative mt-10 lg:mt-0">
          <p className="anim-fade-up text-sm font-medium uppercase tracking-[0.25em] text-accent [animation-delay:120ms]">Design · Build · Deliver</p>
          <h2 className="anim-fade-up mt-3 max-w-lg font-serif [animation-delay:220ms] text-3xl font-semibold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
            One place for every project, from the first enquiry to handover.
          </h2>
          <ul className="mt-8 hidden gap-3 sm:grid sm:grid-cols-2 lg:max-w-xl">
            {POINTS.map(({ icon: Icon, text }, i) => (
              <li key={text} style={{ animationDelay: `${380 + i * 90}ms` }} className="anim-fade-up flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm backdrop-blur transition-colors hover:border-accent/40 hover:bg-white/10">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/90 text-brand-950"><Icon className="h-4.5 w-4.5" aria-hidden /></span>
                {text}
              </li>
            ))}
          </ul>
          <HeroArt className="anim-draw mt-10 hidden h-56 w-full max-w-xl text-accent lg:block" />
        </div>

        <p className="relative mt-10 hidden text-xs text-brand-200 lg:block">Turnkey civil interiors · Fixtures · Project management</p>
      </section>

      {/* form */}
      <section className="relative z-10 -mt-16 px-4 pb-10 lg:mt-0 lg:flex lg:items-center lg:justify-center lg:px-12 lg:pb-0">
        <div className="anim-scale-in mx-auto w-full max-w-md rounded-2xl border [animation-delay:150ms] border-slate-200 bg-white p-7 shadow-xl shadow-brand-900/10 sm:p-9 lg:shadow-2xl">
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-brand-900">Welcome back</h1>
          <p className="mt-1.5 text-sm text-slate-500">Sign in to continue to your work.</p>
          <div className="mt-6 h-0.5 w-12 rounded bg-accent" />
          <LoginForm next={next} />
          <p className="mt-6 text-center text-xs text-slate-500">Forgot your password? Ask the Owner or Admin to set a new one.</p>
        </div>
      </section>
    </main>
  );
}

/** Line drawing of a lit living room in the brand gold. Decorative only. */
function HeroArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 600 260" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {/* floor and rug */}
      <path d="M10 232h580" opacity=".7" />
      <ellipse cx="230" cy="244" rx="190" ry="10" opacity=".35" />
      {/* arched window */}
      <path d="M440 232V70a60 60 0 0 1 120 0v162" opacity=".9" />
      <path d="M500 10v222M440 120h120" opacity=".5" />
      {/* warm light under the pendants */}
      <g stroke="none" fill="currentColor" style={{ filter: "blur(9px)" }}>
        <ellipse className="anim-glow" cx="110" cy="96" rx="34" ry="14" />
        <ellipse className="anim-glow [animation-delay:-1.2s]" cx="210" cy="118" rx="30" ry="12" />
        <ellipse className="anim-glow [animation-delay:-2.4s]" cx="310" cy="80" rx="30" ry="12" />
      </g>
      {/* pendant lights */}
      <path d="M110 0v58M210 0v82M310 0v44" opacity=".8" />
      <path d="M88 58h44l-8 24h-28zM190 82h40l-7 22h-26zM290 44h40l-7 22h-26z" />
      <path d="M96 90l-8 8M124 90l8 8M198 112l-6 6M222 112l6 6M298 74l-6 6M322 74l6 6" opacity=".45" />
      {/* wall frames */}
      <rect x="40" y="96" width="56" height="74" rx="3" opacity=".8" />
      <rect x="52" y="108" width="32" height="50" rx="2" opacity=".4" />
      <rect x="360" y="110" width="44" height="44" rx="3" opacity=".6" />
      {/* sofa */}
      <rect x="70" y="150" width="300" height="56" rx="26" />
      <rect x="86" y="188" width="268" height="40" rx="12" />
      <rect x="54" y="168" width="36" height="60" rx="16" />
      <rect x="350" y="168" width="36" height="60" rx="16" />
      <path d="M100 228v6M340 228v6" />
      <path d="M220 190v38" opacity=".4" />
      {/* cushions */}
      <rect x="110" y="160" width="46" height="36" rx="10" opacity=".8" />
      <rect x="284" y="160" width="46" height="36" rx="10" opacity=".8" />
      {/* side table with lamp */}
      <path d="M420 232v-52M468 232v-52M412 180h64" />
      <path d="M444 180v-30M430 150h28l-5-24h-18z" opacity=".9" />
      {/* plant */}
      <path d="M520 232l-6-44h40l-6 44z" />
      <path d="M534 188c-30-10-40-40-26-60 18 8 28 30 26 60zM534 188c4-34 26-52 46-54-2 24-18 46-46 54zM534 188c-2-24 4-52 18-70" opacity=".8" />
    </svg>
  );
}
