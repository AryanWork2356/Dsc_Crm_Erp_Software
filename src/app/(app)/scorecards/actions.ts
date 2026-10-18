"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertPerm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { notifyUsers } from "@/lib/notify";
import { projectScope } from "@/lib/scope";
import { formToObject, zOptStr } from "@/lib/form";

const yes = z.preprocess((v) => v === true || v === "on" || v === "yes" || v === "true", z.boolean());
const schema = z.object({
  clientRating: z.coerce.number().int().min(1, "Choose the client's rating").max(5),
  reworkRequired: yes,
  snagClosedOnTime: yes,
  labourDiscipline: yes,
  wastageControlled: yes,
  safetyFollowed: yes,
  delayInControl: z.enum(["yes", "no"]).optional(),
  delayReason: zOptStr,
  remarks: zOptStr,
});

/**
 * Records the judgement part of a project's evaluation (the rest is measured). The project's own manager reviews the
 * supervisor; Management / Owner / Admin can review any project.
 */
export async function saveProjectReview(projectId: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("scorecards:edit");
    const p = await db.project.findFirst({ where: { id: projectId, ...projectScope(c) } });
    if (!p) throw new UserError("Project not found or you aren't on it.");
    const wide = ["OWNER", "MANAGEMENT", "ADMIN"].includes(c.role);
    if (!wide && p.projectManagerId !== c.userId) throw new UserError("Only the project's manager or Management can record the evaluation.");
    const raw = formToObject(fd);
    // unticked checkboxes are absent: fd.get() tells us the form was submitted, so missing = No
    const d = schema.parse({ ...raw, reworkRequired: fd.get("reworkRequired"), snagClosedOnTime: fd.get("snagClosedOnTime"), labourDiscipline: fd.get("labourDiscipline"), wastageControlled: fd.get("wastageControlled"), safetyFollowed: fd.get("safetyFollowed") });
    const data = {
      evaluatedById: c.userId, clientRating: d.clientRating, reworkRequired: d.reworkRequired, snagClosedOnTime: d.snagClosedOnTime, labourDiscipline: d.labourDiscipline,
      wastageControlled: d.wastageControlled, safetyFollowed: d.safetyFollowed, delayInControl: d.delayInControl ? d.delayInControl === "yes" : null, delayReason: d.delayReason ?? null, remarks: d.remarks ?? null,
    };
    await db.$transaction(async (tx) => {
      await tx.projectReview.upsert({ where: { projectId }, update: data, create: { ...data, companyId: c.companyId, projectId } });
      await audit(c, { action: "UPDATE", entityType: "ProjectReview", entityId: projectId, summary: `Recorded the performance evaluation for ${p.code} (client rating ${d.clientRating}/5)` }, tx);
      await notifyUsers([p.supervisorId, p.projectManagerId].filter((u): u is string => !!u && u !== c.userId), { companyId: c.companyId, type: "GENERAL", title: `Performance evaluation recorded: ${p.code} ${p.name}`, link: `/scorecards/${projectId}` }, tx);
    });
    revalidatePath("/scorecards");
    revalidatePath(`/scorecards/${projectId}`);
    return { message: "Evaluation saved" };
  });
}
