import { requirePerm } from "@/lib/auth";
import { ACTIONS, MODULES, permissionMatrix } from "@/lib/permissions";
import { humanize } from "@/lib/utils";
import { PageHeader, Alert } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Check } from "lucide-react";

export const metadata = { title: "Roles & Permissions" };

export default async function RolesPage() {
  await requirePerm("settings:view");
  const matrix = permissionMatrix();
  const special = ["margins:view", "salary:view", "finance:view", "audit:view", "users:manage"];

  return (
    <>
      <PageHeader title="Roles & Permissions" subtitle="What each role can do. Pick a role to see its access." />
      <div className="mb-4">
        <Alert>
          Permissions are defined by DSC&apos;s standard role matrix. In addition, data is scoped: Project Managers see their own projects, Clients see only their own project, Vendors see only their own purchase orders.
        </Alert>
      </div>
      <div className="space-y-4">
        {matrix.map((r) => {
          const set = new Set(r.permissions);
          const mods = MODULES.filter((m) => ACTIONS.some((a) => set.has(`${m}:${a}`)));
          return (
            <Card key={r.role}>
              <details>
                <summary className="flex cursor-pointer items-center justify-between px-5 py-4 text-sm font-semibold text-slate-900">
                  {r.label}
                  <span className="text-xs font-normal text-slate-500">{mods.length} modules</span>
                </summary>
                <div className="overflow-x-auto border-t border-slate-100">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">Module</th>
                        {ACTIONS.map((a) => (
                          <th key={a} className="px-3 py-2 text-center font-medium">{a}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {mods.map((m) => (
                        <tr key={m} className="border-t border-slate-100">
                          <td className="px-4 py-2 font-medium text-slate-700">{humanize(m)}</td>
                          {ACTIONS.map((a) => (
                            <td key={a} className="px-3 py-2 text-center">
                              {set.has(`${m}:${a}`) ? <Check className="mx-auto h-4 w-4 text-emerald-600" /> : <span className="text-slate-300">–</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-600">
                    Sensitive access:{" "}
                    {special.filter((s) => set.has(s)).map((s) => humanize(s.replace(":", " "))).join(", ") || "none"}
                  </p>
                </div>
              </details>
            </Card>
          );
        })}
      </div>
    </>
  );
}
