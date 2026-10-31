"use server";
import { revalidatePath } from "next/cache";
import { assertPerm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { run, UserError } from "@/lib/action";
import { projectScope } from "@/lib/scope";
import { validPoint } from "@/lib/geo";
import { SITE_LOCATION_ROLES } from "@/lib/permissions";

function point(fd: FormData) {
  const lat = Number(String(fd.get("lat") ?? "").trim());
  const lng = Number(String(fd.get("lng") ?? "").trim());
  if (!String(fd.get("lat") ?? "").trim() || !String(fd.get("lng") ?? "").trim() || !validPoint(lat, lng)) throw new UserError("Enter the location, or press “Use my current location” while standing at the place.");
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}
function radius(fd: FormData, blankOk: boolean): number | null {
  const raw = String(fd.get("radius") ?? "").trim();
  if (!raw) {
    if (blankOk) return null;
    throw new UserError("Enter the allowed distance in metres.");
  }
  const r = Number(raw);
  if (!Number.isInteger(r) || r < 5 || r > 500) throw new UserError("Allowed distance must be a whole number from 5 to 500 metres.");
  return r;
}

/** Saves where a project's site is. Directors and admins only (it decides where attendance may be marked). */
export async function setSiteLocation(projectId: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("projects:view");
    if (!SITE_LOCATION_ROLES.includes(c.role)) throw new UserError("Only directors and admins set the site location.");
    const p = await db.project.findFirst({ where: { id: projectId, ...projectScope(c) } });
    if (!p) throw new UserError("Project not found or you don't have access to it.");
    const { lat, lng } = point(fd);
    const geoRadiusM = radius(fd, true);
    await db.project.update({ where: { id: projectId }, data: { siteLat: lat, siteLng: lng, geoRadiusM } });
    await audit(c, { action: "UPDATE", entityType: "Project", entityId: projectId, summary: `${c.name} set the site location of ${p.code}${geoRadiusM ? ` (${geoRadiusM} m)` : ""}`, newValue: { lat, lng, geoRadiusM } });
    revalidatePath(`/projects/${projectId}`);
    return { message: "Site location saved" };
  });
}

/** Company-wide: office position, the default allowed distance, and whether self-marking needs the location. */
export async function saveAttendanceLocation(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("settings:manage");
    const geoRequired = fd.get("geoRequired") === "on";
    const geoRadiusM = radius(fd, false)!;
    const hasOffice = String(fd.get("lat") ?? "").trim() || String(fd.get("lng") ?? "").trim();
    const office = hasOffice ? point(fd) : { lat: null, lng: null };
    await db.companySettings.update({ where: { companyId: c.companyId }, data: { geoRequired, geoRadiusM, officeLat: office.lat, officeLng: office.lng } });
    await audit(c, { action: "UPDATE", entityType: "Settings", summary: `${c.name} changed attendance location settings (${geoRequired ? `within ${geoRadiusM} m required` : "location not required"})`, newValue: { geoRequired, geoRadiusM, office } });
    revalidatePath("/settings/attendance");
    return { message: "Attendance location settings saved" };
  });
}
