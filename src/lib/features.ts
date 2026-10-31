/**
 * Features that are built but switched off because DSC does not use them.
 * Set to true to bring them back (menu entries, forms and columns reappear; nothing is deleted).
 */
/** Outside labour contractors: their own list, work orders and "paid through contractor" workers. */
export const USE_CONTRACTORS = false;

/** The leads pipeline (Leads, Follow-ups). Off: people are added straight into Clients. */
export const USE_LEADS = false;

/** The Sales team role. Off: "Sales" is not offered when adding a person; existing Sales logins keep working until deactivated. */
export const USE_SALES_TEAM = false;

/** People change their own password. Off at DSC: passwords are given by the company (Name@number) and only the Admin changes them. */
export const USE_SELF_PASSWORD = false;

/** The Actions & Blockers list. Off: the app still tracks problems in the background, but tells people through notifications (bell and phone). */
export const USE_ACTIONS = false;

/** Site visits before a project (sales visits). Off at DSC. */
export const USE_SITE_VISITS = false;

/** Customer support tickets. Off at DSC. */
export const USE_SUPPORT = false;

/** The Site Material section: material receipts list, issues & returns, waste & reconciliation, transfers. Off at DSC.
 *  Receiving a delivery against a purchase order (from the order's page) still works for procurement. */
export const USE_SITE_MATERIAL = false;
const SITE_MATERIAL = ["/inventory/receipts", "/inventory/issues", "/inventory/waste", "/transfers"];

/** Menu entries that belong to a feature that is switched off. */
export function featureOff(href: string): boolean {
  return (!USE_CONTRACTORS && href.startsWith("/workforce/contractors")) || (!USE_LEADS && ["/crm/leads", "/crm/follow-ups"].includes(href))
    || (!USE_ACTIONS && href.startsWith("/actions")) || (!USE_SITE_VISITS && href.startsWith("/crm/site-visits")) || (!USE_SUPPORT && href.startsWith("/support"))
    || (!USE_SITE_MATERIAL && SITE_MATERIAL.some((p) => href === p || href.startsWith(`${p}/`) || href.startsWith(`${p}?`)));
}
