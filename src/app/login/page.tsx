import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { getCtx } from "@/lib/auth";
import { homeFor } from "@/lib/home";
import { LoginForm } from "./login-form";
import { LanguageSwitcher } from "@/components/layout/language";

export const metadata = { title: "Sign in" };

const FADE = "linear-gradient(to right, transparent, #000 9%, #000 91%, transparent), linear-gradient(to bottom, transparent, #000 14%, #000 86%, transparent)";

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

      {/* DSC logo panel: the picture only, no text on top of it */}
      <section className="relative isolate flex items-center justify-center overflow-hidden bg-[#361210] pb-20 pt-4 lg:min-h-screen lg:pb-0 lg:pt-0">
        {/* the picture fades into the panel colour on every side, so it looks right at any width or height */}
        <Image
          src="/brand/dsc-login.jpeg" alt="DSC Interior Pvt. Ltd." width={980} height={672} priority sizes="(min-width: 1024px) 55vw, 100vw"
          className="anim-fade-up h-auto w-full max-w-3xl object-contain"
          style={{ maskImage: FADE, WebkitMaskImage: FADE, maskComposite: "intersect", WebkitMaskComposite: "source-in" }}
        />
      </section>

      {/* form */}
      <section className="relative z-10 -mt-16 px-4 pb-10 lg:mt-0 lg:flex lg:items-center lg:justify-center lg:px-12 lg:pb-0">
        <div className="anim-scale-in mx-auto w-full max-w-md rounded-2xl border [animation-delay:150ms] border-slate-200 bg-white p-7 shadow-xl shadow-brand-900/10 sm:p-9 lg:shadow-2xl">
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-brand-900">Welcome back</h1>
          <p className="mt-1.5 text-sm text-slate-500">Sign in to continue to your work.</p>
          <div className="mt-6 h-0.5 w-12 rounded bg-accent" />
          <LoginForm next={next} />
          <p className="mt-6 text-center text-xs text-slate-500"><Link href="/forgot-password" className="font-medium text-brand-700 hover:underline">Forgot your password?</Link> The Owner or Admin will give you a temporary one.</p>
        </div>
      </section>
    </main>
  );
}
