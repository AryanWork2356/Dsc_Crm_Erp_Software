import type { RoleKey } from "@prisma/client";

/** Landing route per role. Workers/clients/vendors get purpose-built, simplified experiences. */
export function homeFor(role: RoleKey): string {
  switch (role) {
    case "WORKER":
      return "/worker";
    case "CLIENT":
      return "/portal";
    case "VENDOR":
      return "/vendor-portal";
    default:
      return "/dashboard";
  }
}
