import { describe, it, expect } from "vitest";
import { helpFor, HELP_PATTERNS } from "@/lib/help";
import { NAV } from "@/lib/nav";

describe("the i button (screen help)", () => {
  it("every menu item has its own help, not the general note", () => {
    const general = helpFor("/not-a-real-page-xyz").title;
    for (const g of NAV) for (const i of g.items.length ? g.items : g.href ? [{ href: g.href, label: g.label }] : []) {
      expect(helpFor(i.href).title, i.href).not.toBe(general);
    }
  });

  it("a record's own page gets its own help, and unknown deeper pages fall back to the closest parent", () => {
    expect(helpFor("/projects/cmabc123").title).toBe("Project");
    expect(helpFor("/projects").title).toBe("Projects");
    expect(helpFor("/projects/tasks").title).toBe("Tasks");
    expect(helpFor("/crm/clients/xyz789").title).toBe("Client");
    expect(helpFor("/finance/invoices/new").title).toBe("New invoice");
    expect(helpFor("/finance/invoices/cm123").title).toBe("Invoice");
    expect(helpFor("/feasibility/quotation/abc").title).toMatch(/Feasibility/);
    expect(helpFor("/finance/invoices/cm123/edit").title).toBe("Invoice");
  });

  it("each help text has a purpose, things to do and an example", () => {
    for (const p of HELP_PATTERNS) {
      const h = helpFor(p.replace(/:[a-z]+/g, "x1"));
      expect(h.purpose.length, p).toBeGreaterThan(20);
      expect(h.can.length, p).toBeGreaterThan(0);
      expect(h.example.length, p).toBeGreaterThan(15);
    }
  });
});
