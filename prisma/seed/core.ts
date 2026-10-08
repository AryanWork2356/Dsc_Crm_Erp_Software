import type { PrismaClient, RoleKey } from "@prisma/client";

export type CoreSeed = {
  companyId: string;
  users: { id: string; email: string; name: string; role: RoleKey }[];
  byRole: Partial<Record<RoleKey, string>>; // first user id per role
};

const STAFF: { role: RoleKey; name: string; email: string; designation: string; department: string; phone: string; salary: number }[] = [
  { role: "OWNER", name: "Rupesh Sharma", email: "owner@dsc.demo", designation: "Managing Director", department: "Management", phone: "+91 98200 10001", salary: 0 },
  { role: "MANAGEMENT", name: "Neha Kulkarni", email: "director@dsc.demo", designation: "Director - Operations", department: "Management", phone: "+91 98200 10002", salary: 180000 },
  { role: "ADMIN", name: "Sandeep Pawar", email: "admin@dsc.demo", designation: "Office Administrator", department: "Admin", phone: "+91 98200 10003", salary: 45000 },
  { role: "SALES", name: "Rohan Mehta", email: "sales@dsc.demo", designation: "Senior Sales Executive", department: "Sales", phone: "+91 98200 10004", salary: 60000 },
  { role: "SALES", name: "Priya Nair", email: "sales2@dsc.demo", designation: "Sales Executive", department: "Sales", phone: "+91 98200 10005", salary: 42000 },
  { role: "PROJECT_MANAGER", name: "Amit Joshi", email: "pm@dsc.demo", designation: "Project Manager", department: "Projects", phone: "+91 98200 10006", salary: 95000 },
  { role: "PROJECT_MANAGER", name: "Kavita Rao", email: "pm2@dsc.demo", designation: "Project Manager", department: "Projects", phone: "+91 98200 10007", salary: 90000 },
  { role: "DESIGNER", name: "Ishita Shah", email: "designer@dsc.demo", designation: "Interior Designer", department: "Design", phone: "+91 98200 10008", salary: 70000 },
  { role: "PROCUREMENT", name: "Vikram Patil", email: "procurement@dsc.demo", designation: "Procurement Manager", department: "Procurement", phone: "+91 98200 10009", salary: 65000 },
  { role: "ACCOUNTS", name: "Sunita Iyer", email: "accounts@dsc.demo", designation: "Accounts Manager", department: "Finance", phone: "+91 98200 10010", salary: 70000 },
  { role: "HR", name: "Meera Kapoor", email: "hr@dsc.demo", designation: "HR Executive", department: "HR", phone: "+91 98200 10011", salary: 52000 },
  { role: "STORE", name: "Ganesh Shinde", email: "store@dsc.demo", designation: "Store Keeper", department: "Stores", phone: "+91 98200 10012", salary: 32000 },
  { role: "SITE_ENGINEER", name: "Tushar Bhosale", email: "engineer@dsc.demo", designation: "Site Engineer", department: "Projects", phone: "+91 98200 10013", salary: 58000 },
  { role: "SITE_SUPERVISOR", name: "Mahesh Gaikwad", email: "supervisor@dsc.demo", designation: "Site Supervisor", department: "Projects", phone: "+91 98200 10014", salary: 38000 },
];

export async function seedCore(prisma: PrismaClient, passwordHash: string): Promise<CoreSeed> {
  const company = await prisma.company.upsert({
    where: { slug: "dsc-interior" },
    update: {},
    create: { name: "DSC Interior Pvt. Ltd.", slug: "dsc-interior" },
  });
  const companyId = company.id;

  await prisma.companySettings.upsert({
    where: { companyId },
    update: {},
    create: {
      companyId,
      legalName: "DSC Interior Pvt. Ltd.",
      address: "Thane West, Mumbai Metropolitan Region, Maharashtra 400601",
      phone: "+91 22 4000 1234",
      email: "info@dscinterior.com",
      website: "https://dscinterior.com",
      gstin: "27AABCD1234E1Z5",
      pan: "AABCD1234E",
      bankName: "HDFC Bank",
      bankAccountNo: "50200012345678",
      bankIfsc: "HDFC0000123",
      bankBranch: "Thane West",
    },
  });

  await prisma.termsAndConditions.deleteMany({ where: { companyId } });
  await prisma.termsAndConditions.createMany({
    data: [
      {
        companyId, kind: "QUOTATION", name: "Standard interior terms", isDefault: true,
        body: "1. Quotation valid for 30 days from date of issue.\n2. Rates are based on the approved BOQ and drawings; any change in scope will be quoted separately.\n3. GST extra as applicable.\n4. Work will commence after receipt of the advance payment.\n5. Material brands/finishes as specified in the BOQ; equivalent make may be substituted with client approval.\n6. Defect liability: 12 months from handover for workmanship.",
      },
      { companyId, kind: "QUOTATION", name: "Payment terms - milestone", isDefault: false, body: "40% advance, 30% on carcass completion, 20% on finishing, 10% on handover." },
      { companyId, kind: "PO", name: "Standard PO terms", isDefault: true, body: "1. Delivery to site as per schedule.\n2. Goods subject to inspection and acceptance.\n3. Invoice must quote the PO number.\n4. Payment as per agreed terms after material receipt." },
    ],
  });

  const users: CoreSeed["users"] = [];
  const byRole: CoreSeed["byRole"] = {};
  let codeNo = 1;
  for (const s of STAFF) {
    const u = await prisma.user.upsert({
      where: { companyId_email: { companyId, email: s.email } },
      update: {},
      create: { companyId, email: s.email, name: s.name, phone: s.phone, role: s.role, passwordHash },
    });
    users.push({ id: u.id, email: u.email, name: u.name, role: u.role });
    byRole[s.role] ??= u.id;

    const code = `EMP-${String(codeNo++).padStart(3, "0")}`;
    const emp = await prisma.employee.upsert({
      where: { companyId_code: { companyId, code } },
      update: {},
      create: {
        companyId, userId: u.id, code, name: s.name, email: s.email, phone: s.phone,
        designation: s.designation, department: s.department, joiningDate: new Date("2023-04-01"),
        workLocation: "Thane Office",
      },
    });
    if (s.salary > 0) {
      await prisma.salaryStructure.upsert({
        where: { employeeId: emp.id },
        update: {},
        create: {
          companyId, employeeId: emp.id, basic: Math.round(s.salary * 0.5), hra: Math.round(s.salary * 0.2),
          allowances: Math.round(s.salary * 0.3), deductions: 0,
        },
      });
    }
  }
  await prisma.sequence.upsert({ where: { companyId_key: { companyId, key: "EMP" } }, update: { value: codeNo - 1 }, create: { companyId, key: "EMP", value: codeNo - 1 } });
  return { companyId, users, byRole };
}
