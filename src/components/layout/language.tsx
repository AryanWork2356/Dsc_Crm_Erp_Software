"use client";
import * as React from "react";
import { Globe } from "lucide-react";
import { LANGS, cookieFor, langFromCookie, type LangCode } from "@/lib/lang";
import { cn } from "@/lib/utils";

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

    // Any translator (ours, Chrome's own "Translate this page", an extension) rewrites text nodes. When React later removes
    // or reorders such a node it throws and the whole screen goes blank. These guards make that harmless, so they are
    // always on, whatever language is chosen.
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

    restoreTyping(); // what was typed before a reload for the language (see LanguageSwitcher)
    if (code === "en") return; // the Google translator is loaded only when a language is chosen
    loadTranslator();
  }, []);
  return <div id="google_translate_element" className="hidden" aria-hidden />;
}

function loadTranslator() {
  window.googleTranslateElementInit = () => {
    if (window.google) new window.google.translate.TranslateElement({ pageLanguage: "en", includedLanguages: LANGS.map((l) => l.code).join(","), autoDisplay: false }, "google_translate_element");
  };
  if (!document.getElementById("google-translate-script")) {
    const s = document.createElement("script");
    s.id = "google-translate-script";
    s.src = "https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
    s.async = true;
    document.body.appendChild(s);
  }
}

/** The page is being translated (Google marks the page while it shows another language). */
const translated = () => /translated-(ltr|rtl)/.test(document.documentElement.className);

/** Switches the language on the page itself, without reloading it, so nothing typed is lost. False when that is not possible. */
function switchInPlace(next: LangCode): boolean {
  const combo = document.querySelector<HTMLSelectElement>("select.goog-te-combo");
  if (!combo) {
    if (next === "en") return !translated();
    loadTranslator(); // first language this visit: the translator reads the choice from the cookie when it starts
    return true;
  }
  combo.value = next;
  combo.dispatchEvent(new Event("change"));
  return true;
}

type Box = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
const fields = () => [...document.querySelectorAll<Box>("input, textarea, select")].filter((e) => !(e instanceof HTMLInputElement && ["hidden", "file", "submit", "button", "password"].includes(e.type)) && !e.classList.contains("goog-te-combo") && e.getAttribute("aria-label") !== "Language");
const changed = (e: Box) =>
  e instanceof HTMLSelectElement ? [...e.options].some((o) => o.selected !== o.defaultSelected)
  : e instanceof HTMLInputElement && (e.type === "checkbox" || e.type === "radio") ? e.checked !== e.defaultChecked
  : e.value !== e.defaultValue;
const TYPED = "dsc-typed";

/** Keeps what was typed on this page across a reload (only used when the language can't change in place). */
function keepTyping() {
  const all = fields();
  const list = all.map((e, i) => ({ i, name: e.getAttribute("name"), value: e instanceof HTMLInputElement && (e.type === "checkbox" || e.type === "radio") ? String(e.checked) : e.value, changed: changed(e) })).filter((x) => x.changed);
  if (!list.length) return;
  try { sessionStorage.setItem(TYPED, JSON.stringify({ path: location.pathname + location.search, count: all.length, list })); } catch { /* private window */ }
}

function restoreTyping() {
  let saved: { path: string; count: number; list: { i: number; name: string | null; value: string }[] } | null = null;
  try { saved = JSON.parse(sessionStorage.getItem(TYPED) ?? "null"); sessionStorage.removeItem(TYPED); } catch { return; }
  if (!saved || saved.path !== location.pathname + location.search) return;
  const put = () => {
    const all = fields();
    const sameBoxes = all.length === saved!.count; // boxes without a name are matched by position only when the page is laid out the same
    for (const x of saved!.list) {
      const el = x.name ? all.find((e) => e.getAttribute("name") === x.name) : sameBoxes ? all[x.i] : undefined;
      if (!el) continue;
      if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) { if (el.checked !== (x.value === "true")) el.click(); continue; }
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
      setter ? setter.call(el, x.value) : (el.value = x.value);
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
    }
  };
  setTimeout(put, 300); // after the page's forms are on screen
}

/** Globe button with the languages. Choosing one switches the page in place, so what is typed in a form stays. */
const TONES = {
  light: { box: "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 focus:border-brand-500 focus:ring-brand-200", icon: "text-slate-500" },
  dark: { box: "border-white/15 bg-white/5 text-slate-200 hover:bg-white/10 focus:border-accent focus:ring-accent/30", icon: "text-slate-400" },
  // sign-in page: sits on the navy hero on a phone and on the white panel on a computer
  auto: { box: "border-white/30 bg-white/10 text-white hover:bg-white/20 focus:border-accent focus:ring-accent/30 lg:border-slate-200 lg:bg-white lg:text-slate-700 lg:hover:bg-slate-50", icon: "text-white/80 lg:text-slate-500" },
} as const;

export function LanguageSwitcher({ className = "", tone = "light", fullWidth = false }: { className?: string; tone?: keyof typeof TONES; fullWidth?: boolean }) {
  const [code, setCode] = React.useState<LangCode>("en");
  React.useEffect(() => setCode(langFromCookie(document.cookie)), []);

  function choose(next: LangCode) {
    if (next === code) return;
    document.cookie = cookieFor(next);
    if (next === "en") for (const d of [location.hostname, `.${location.hostname}`, `.${location.hostname.split(".").slice(-3).join(".")}`]) document.cookie = `googtrans=; path=/; domain=${d}; max-age=0`;
    setCode(next);
    if (switchInPlace(next)) {
      // going back to English: if the page still shows the other language a moment later, reload, keeping what was typed
      if (next === "en") setTimeout(() => { if (translated()) { keepTyping(); window.location.reload(); } }, 900);
      return;
    }
    keepTyping();
    window.location.reload();
  }

  return (
    <label className={cn("notranslate relative inline-flex items-center", fullWidth && "w-full", className)} translate="no" title="Language">
      <Globe className={`pointer-events-none absolute left-2.5 h-4 w-4 ${TONES[tone].icon}`} aria-hidden />
      <select value={code} onChange={(e) => choose(e.target.value as LangCode)} aria-label="Language" className={`h-9 cursor-pointer appearance-none rounded-lg border pl-8 pr-3 text-sm focus:outline-none focus:ring-2 ${fullWidth ? "w-full" : ""} ${TONES[tone].box}`}>
        {LANGS.map((l) => <option key={l.code} value={l.code} className="text-slate-900">{l.label}</option>)}
      </select>
    </label>
  );
}
