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
