import type { PrismaClient } from "@prisma/client";

/** Demo daily site reports for live projects over the last working days (idempotent: skips days that already have one). */
export async function seedSiteReports(prisma: PrismaClient) {
  const sup = await prisma.user.findFirst({ where: { role: "SITE_SUPERVISOR", isActive: true } });
  if (!sup) return;
  const projects = await prisma.project.findMany({ where: { companyId: sup.companyId, status: "EXECUTION", supervisorId: sup.id } });
  const plans = ["Flooring – hall and passage", "False ceiling grid – bedrooms", "Carpentry – wardrobe carcass", "Painting prep and putty", "Electrical fixtures and switches"];
  for (const p of projects) {
    let made = 0;
    for (let back = 1; back <= 8 && made < 5; back++) {
      const d = new Date(Date.now() - back * 86400000);
      const day = new Date(d.toISOString().slice(0, 10) + "T00:00:00.000Z");
      if (day.getUTCDay() === 0) continue; // Sunday
      made++;
      const i = made - 1;
      const missingEvening = made === 3; // one missed evening report so the discipline table has a gap
      for (const kind of ["MORNING", "EVENING"] as const) {
        if (kind === "EVENING" && missingEvening) continue;
        await prisma.dailyReport.upsert({
          where: { projectId_reportDate_kind: { projectId: p.id, reportDate: day, kind } },
          update: {},
          create: {
            companyId: p.companyId, projectId: p.id, reportDate: day, kind, submittedById: sup.id,
            submittedAt: new Date(day.getTime() + (kind === "MORNING" ? 4.5 : 13) * 3600000), // ~10:00 / ~18:30 IST
            onTime: !(kind === "MORNING" && made === 4),
            manpower: 8 + i, progressPct: kind === "EVENING" ? 35 + (5 - i) * 5 : null,
            workDone: kind === "EVENING" ? `${plans[i % plans.length]} – completed as planned.` : null,
            planNext: plans[(i + 1) % plans.length],
            materialStatus: kind === "EVENING" && made === 2 ? "SHORT_SOON" : "OK",
            issues: kind === "EVENING" && made === 2 ? "Tile adhesive will finish by tomorrow afternoon." : null,
          },
        });
      }
    }
  }
}
