import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * First-run setup for a REAL installation: creates the company, its settings and the first Owner login – with no demo
 * data. Refuses to run if the company already has users, so it can never overwrite a live system.
 */
export type SetupOptions = {
  companyName: string;
  slug?: string;
  gstin?: string;
  pan?: string;
  address?: string;
  phone?: string;
  email?: string;
  ownerName: string;
  ownerEmail: string;
  password: string;
};

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/i;

export function validateSetup(o: SetupOptions): string[] {
  const problems: string[] = [];
  if (!o.companyName.trim()) problems.push("Company name is required.");
  if (!o.ownerName.trim()) problems.push("Owner name is required.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.ownerEmail)) problems.push("Owner email is not valid.");
  if (o.password.length < 10) problems.push("The password must be at least 10 characters.");
  if (/^(password|demo@1234|12345678)/i.test(o.password)) problems.push("Choose a stronger password than that.");
  if (o.gstin && !GSTIN.test(o.gstin.trim())) problems.push("GSTIN does not look right (15 characters, e.g. 27AAECD2813K1ZP).");
  return problems;
}

export async function setupCompany(prisma: PrismaClient, o: SetupOptions): Promise<{ companyId: string; ownerId: string }> {
  const problems = validateSetup(o);
  if (problems.length) throw new Error(problems.join(" "));
  const slug = (o.slug ?? o.companyName).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const existing = await prisma.company.findUnique({ where: { slug }, include: { _count: { select: { users: true } } } });
  if (existing && existing._count.users > 0) throw new Error(`The company "${o.companyName}" is already set up (${existing._count.users} user(s)). Nothing was changed.`);

  const company = existing ?? (await prisma.company.create({ data: { name: o.companyName.trim(), slug } }));
  await prisma.companySettings.upsert({
    where: { companyId: company.id },
    update: {},
    create: { companyId: company.id, legalName: o.companyName.trim(), gstin: o.gstin?.trim().toUpperCase(), pan: o.pan?.trim().toUpperCase(), address: o.address, phone: o.phone, email: o.email },
  });
  const owner = await prisma.user.create({
    data: { companyId: company.id, email: o.ownerEmail.trim().toLowerCase(), name: o.ownerName.trim(), role: "OWNER", passwordHash: await bcrypt.hash(o.password, 11) },
  });
  await prisma.employee.create({ data: { companyId: company.id, userId: owner.id, code: "EMP-001", name: o.ownerName.trim(), email: o.ownerEmail.trim().toLowerCase(), designation: "Owner", department: "Management" } });
  await prisma.sequence.upsert({ where: { companyId_key: { companyId: company.id, key: "EMP" } }, update: {}, create: { companyId: company.id, key: "EMP", value: 1 } });
  return { companyId: company.id, ownerId: owner.id };
}
