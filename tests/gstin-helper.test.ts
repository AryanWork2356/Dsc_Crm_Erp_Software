import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { loginAs, fd } from "./setup";
import { gstinChecksumOk, panFromGstin, readGstin } from "@/lib/gst";
import { createClient } from "@/app/(app)/crm/actions";

describe("GSTIN helper", () => {
  it("reads state and PAN from a real GSTIN and checks the last character", () => {
    const r = readGstin("27AAPFU0939F1ZV");
    expect(r).toEqual({ state: "Maharashtra", pan: "AAPFU0939F", checksumOk: true });
    expect(gstinChecksumOk("07AAGFF2194N1Z1")).toBe(true);
  });

  it("catches a typing slip and a wrong shape", () => {
    expect(gstinChecksumOk("27AAPFU0939F1ZW")).toBe(false);
    expect(panFromGstin("not a gstin")).toBeNull();
    expect(panFromGstin(null)).toBeNull();
  });

  it("a new client with only a GSTIN gets the PAN filled in; a PAN of another company is refused", async () => {
    await loginAs("admin@dsc.demo");
    const tag = Date.now().toString(36);
    const ok = await createClient(fd({ name: `Gst Client ${tag}`, gstin: "27AAPFU0939F1ZV" }));
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      const row = await db.client.findFirstOrThrow({ where: { id: (ok.data as { id: string }).id } });
      expect(row.pan).toBe("AAPFU0939F");
    }
    const bad = await createClient(fd({ name: `Gst Client B ${tag}`, gstin: "27AAPFU0939F1ZV", pan: "ABCDE1234F" }));
    expect(bad.ok).toBe(false);
  });
});
