"use client";

/** Last resort when even the page frame breaks: a plain reload screen instead of a white page. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#f8fafc", color: "#0f172a", margin: 0 }}>
        <div style={{ maxWidth: 520, margin: "80px auto", padding: 24, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 16 }}>
          <h1 style={{ fontSize: 20, margin: 0 }}>Something went wrong loading the app</h1>
          <p style={{ fontSize: 14 }}>Press Try again. If it keeps happening, turn off your browser&apos;s &quot;Translate this page&quot; for this site and reload.</p>
          <button onClick={reset} style={{ background: "#1b3260", color: "white", border: 0, borderRadius: 8, padding: "10px 16px", fontSize: 14, cursor: "pointer" }}>Try again</button>
          <p style={{ fontSize: 11, color: "#78716c", wordBreak: "break-word", marginTop: 16 }}>{error.message}{error.digest ? ` · ref ${error.digest}` : ""}</p>
        </div>
      </body>
    </html>
  );
}
