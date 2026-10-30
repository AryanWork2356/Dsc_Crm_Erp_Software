import "server-only";
import { SignJWT, importPKCS8 } from "jose";
import { BillReadError } from "./bill-reader-shared";

/**
 * The free reader: Google Cloud Vision reads the text on a photo or PDF (handwriting included); bill-text.ts then picks out the boxes.
 * Google's free allowance is 1,000 pages a month. Sign-in uses a service account (the JSON key in GOOGLE_VISION_CREDENTIALS), because
 * Google does not accept simple API keys for PDF reading.
 */
type Creds = { client_email: string; private_key: string; project_id?: string };

function creds(): Creds | null {
  const raw = process.env.GOOGLE_VISION_CREDENTIALS;
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<Creds>;
    return j.client_email && j.private_key ? { client_email: j.client_email, private_key: j.private_key, project_id: j.project_id } : null;
  } catch {
    return null;
  }
}
export const googleReadingOn = () => !!creds();

let cached: { token: string; exp: number } | null = null;
async function accessToken(c: Creds): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(c.private_key.replace(/\n/g, "\n"), "RS256");
  const jwt = await new SignJWT({ scope: "https://www.googleapis.com/auth/cloud-platform" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" }).setIssuer(c.client_email).setSubject(c.client_email)
    .setAudience("https://oauth2.googleapis.com/token").setIssuedAt(now).setExpirationTime(now + 3600).sign(key);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }), signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new BillReadError("Bill reading is not set up correctly. Please tell the Admin; you can still type the details.");
  const j = (await r.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new BillReadError("Bill reading is not set up correctly. Please tell the Admin; you can still type the details.");
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return j.access_token;
}

type Annotation = { text?: string; pages?: { blocks?: { paragraphs?: { words?: { confidence?: number }[] }[] }[] }[] };
const confidences = (a: Annotation | undefined) => (a?.pages ?? []).flatMap((p) => (p.blocks ?? []).flatMap((b) => (b.paragraphs ?? []).flatMap((q) => (q.words ?? []).map((w) => w.confidence).filter((n): n is number => typeof n === "number"))));

/** The text on the file, and how sure Google was of it (0 to 1, the average over all words). */
export async function readTextGoogle(bytes: Buffer, mime: string): Promise<{ text: string; confidence: number }> {
  const c = creds();
  if (!c) throw new BillReadError("Bill reading is not set up. Please type the details.");
  const pdf = mime === "application/pdf";
  const url = pdf ? "https://vision.googleapis.com/v1/files:annotate" : "https://vision.googleapis.com/v1/images:annotate";
  const content = bytes.toString("base64");
  const body = pdf
    ? { requests: [{ inputConfig: { content, mimeType: "application/pdf" }, features: [{ type: "DOCUMENT_TEXT_DETECTION" }], pages: [1, 2, 3] }] }
    : { requests: [{ image: { content }, features: [{ type: "DOCUMENT_TEXT_DETECTION" }] }] };
  let r: Response;
  try {
    r = await fetch(url, {
      method: "POST", signal: AbortSignal.timeout(45_000),
      headers: { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${await accessToken(c)}`, ...(c.project_id ? { "x-goog-user-project": c.project_id } : {}) },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (e instanceof BillReadError) throw e;
    throw new BillReadError("Bill reading did not work this time. You can type the details; the photo is still saved with the bill.");
  }
  if (r.status === 401 || r.status === 403) throw new BillReadError("Bill reading is not set up correctly. Please tell the Admin; you can still type the details.");
  if (r.status === 429) throw new BillReadError("Bill reading is busy right now. Please try again in a minute, or type the details.");
  if (!r.ok) throw new BillReadError("This file could not be read. Try a clearer photo, or a smaller PDF.");
  const j = (await r.json()) as { responses?: ({ fullTextAnnotation?: Annotation; error?: { message?: string }; responses?: { fullTextAnnotation?: Annotation }[] })[] };
  const first = j.responses?.[0];
  if (first?.error) throw new BillReadError("This file could not be read. Try a clearer photo, or a smaller PDF.");
  const annotations = pdf ? (first?.responses ?? []).map((x) => x.fullTextAnnotation) : [first?.fullTextAnnotation];
  const text = annotations.map((a) => a?.text ?? "").join("\n").trim();
  const all = annotations.flatMap(confidences);
  return { text, confidence: all.length ? all.reduce((s, n) => s + n, 0) / all.length : text ? 0.7 : 0 };
}
