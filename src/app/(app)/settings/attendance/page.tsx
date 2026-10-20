import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEFAULT_RADIUS_M } from "@/lib/geo";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { LocationForm } from "@/components/forms/location-form";
import { saveAttendanceLocation } from "@/app/(app)/workforce/location-actions";

export const metadata = { title: "Attendance location" };

export default async function AttendanceLocationPage() {
  const c = await requirePerm("settings:manage");
  const s = await db.companySettings.findUnique({ where: { companyId: c.companyId } });
  return (
    <>
      <PageHeader title="Attendance location" subtitle="Workers and staff can mark themselves present only when their phone is near the site or the office." />
      <Card>
        <CardHeader><CardTitle>Office and allowed distance</CardTitle></CardHeader>
        <CardBody>
          <LocationForm
            action={saveAttendanceLocation}
            lat={s?.officeLat ?? null}
            lng={s?.officeLng ?? null}
            radius={s?.geoRadiusM ?? DEFAULT_RADIUS_M}
            radiusHint="20"
            requireRadius
            extra={
              <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <input type="checkbox" name="geoRequired" defaultChecked={s?.geoRequired ?? true} className="mt-0.5 h-5 w-5 accent-brand-700" />
                <span><b className="text-slate-900">Marking needs the location.</b> A person can mark attendance only within the allowed distance of their site (or the office for staff). Switch off to let people mark from anywhere.</span>
              </label>
            }
          />
        </CardBody>
      </Card>
      <Card className="mt-5">
        <CardBody className="space-y-2 text-sm text-slate-600">
          <p><b className="text-slate-900">Each site has its own location.</b> Open the project, then <b>Overview → Site location</b>, stand at the site and press <b>Use my current location</b>. A site can also have its own allowed distance.</p>
          <p><b className="text-slate-900">20 metres is strict.</b> A phone&apos;s GPS can be 10 to 30 metres out, especially inside a building or between tall buildings. If good workers get turned away, raise the distance to 30 or 50 metres. The app also refuses a position that is not clear (more than 50 metres of doubt).</p>
          <p>A supervisor or HR can still mark someone by hand when needed (for example a phone with no signal). Those entries are recorded as <b>Manual</b>.</p>
        </CardBody>
      </Card>
    </>
  );
}
