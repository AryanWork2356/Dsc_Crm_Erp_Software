"use client";
import * as React from "react";
import { Globe } from "lucide-react";
import { LANGS, cookieFor, langFromCookie, type LangCode } from "@/lib/lang";

declare global {
  interface Window {
    googleTranslateElementInit?: () => void;
    google?: { translate: { TranslateElement: new (o: { pageLanguage: string; includedLanguages: string; autoDisplay: boolean }, id: string) => unknown } };
  }
}

/**
 * Loads the browser translator once a language other than English is chosen. Translation rewrites text in the page,
 * which can confuse React when it later removes an element; the two guards below make that harmless.
 */
export function TranslateLoader() {
  React.useEffect(() => {
    const code = langFromCookie(document.cookie);
    document.documentElement.lang = code;
    if (code === "en") return;

    const proto = Node.prototype as Node & { __guarded?: boolean };
    if (!proto.__guarded) {
      proto.__guarded = true;
      const remove = Node.prototype.removeChild;
      Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
        if (child.parentNode !== this) return child;
        return remove.call(this, child) as T;
      };
      const insert = Node.prototype.insertBefore;
      Node.prototype.insertBefore = function <T extends Node>(this: Node, node: T, ref: Node | null): T {
        if (ref && ref.parentNode !== this) return node;
        return insert.call(this, node, ref) as T;
      };
    }

    window.googleTranslateElementInit = () => {
      if (window.google) new window.google.translate.TranslateElement({ pageLanguage: "en", includedLanguages: "hi,mr,gu", autoDisplay: false }, "google_translate_element");
    };
    if (!document.getElementById("google-translate-script")) {
      const s = document.createElement("script");
      s.id = "google-translate-script";
      s.src = "https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
      s.async = true;
      document.body.appendChild(s);
    }
  }, []);
  return <div id="google_translate_element" className="hidden" aria-hidden />;
}

/** Globe button with the four languages. Choosing one saves it on this device and reloads the page. */
export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const [code, setCode] = React.useState<LangCode>("en");
  React.useEffect(() => setCode(langFromCookie(document.cookie)), []);

  function choose(next: LangCode) {
    if (next === code) return;
    document.cookie = cookieFor(next);
    window.location.reload();
  }

  return (
    <label className={`notranslate relative inline-flex items-center ${className}`} translate="no" title="Language">
      <Globe className="pointer-events-none absolute left-2 h-4 w-4 text-slate-500" aria-hidden />
      <select value={code} onChange={(e) => choose(e.target.value as LangCode)} aria-label="Language" className="h-9 cursor-pointer appearance-none rounded-lg border border-slate-200 bg-white pl-8 pr-2 text-sm text-slate-700 hover:bg-slate-50 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200">
        {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
      </select>
    </label>
  );
}
