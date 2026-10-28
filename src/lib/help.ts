/**
 * The text behind the "i" button at the top of every screen: what the screen is for, what a person can do on it, and one example.
 * Plain data (no server code) so the button can use it in the browser. Pages are matched by their address: ":id" matches any one
 * part (a record number), and the most specific match wins, so a project's own page has its own help and everything else falls
 * back to the closest parent. Written for DSC's staff, in simple words.
 */

export type Help = {
  title: string;
  purpose: string; // what this screen is used for
  can: string[]; // what you can do here
  example: string; // one real-life example
};

type Entry = [pattern: string, help: Help];

const H = (title: string, purpose: string, can: string[], example: string): Help => ({ title, purpose, can, example });

const ENTRIES: Entry[] = [
  ["/dashboard", H("Dashboard", "Your home page: the money, projects and alerts that matter today.", ["See the numbers for today, this week, this month or this year", "Open 'Needs you' to see the actions assigned to you", "Mark your attendance", "Click any card to open the full list behind it"], "Open it each morning, look at 'Needs you', and clear the red items first.")],
  ["/actions", H("Actions & Blockers", "A to-do list of who must do what by when. The app also adds items itself, for example when a task is blocked or a delivery is late.", ["Add an action with an owner, a due date and how serious it is", "Press Start when you begin, and Done when finished (write what you did)", "Change the owner or the date (a reason is needed)", "See what is late: owners, then the Project Manager, then directors are told"], "'Blocked: no power at Flat 4' is raised for the Project Manager. He starts it, fixes the supply, and writes 'MSEB connection restored'.")],
  ["/approvals", H("Approvals", "Everything waiting for somebody's yes or no: quotations, BOQs, big payments, purchase requests, extra work.", ["Open a request and read the details", "Approve it, or reject it with a reason", "See who asked and when"], "Accounts asks to pay a vendor Rs. 80,000. It shows here for Management, who read it and press Approve.")],
  ["/time-limits", H("Time Limits", "The board of things that are waiting too long, and who has been told.", ["See what is late and by how long", "Open the item to act on it", "Directors can see who is slow and where it is stuck"], "A quotation promised within 24 hours of the visit is still unsent after 30 hours. It shows red here.")],
  ["/exceptions", H("Exceptions", "Only what needs attention today: projects with no manager, budget or dates, late milestones, moved dates, forecast losses, missed payment promises.", ["Read each list and click a line to open the record", "Use it as your morning check instead of opening every project"], "'Hospital Wing A: no daily report for 4 days'. Click it, and ask the supervisor why.")],
  ["/kpis", H("Key numbers", "Eight numbers that tell how the company is doing, each worked out from real records with its method written under it.", ["Open 'How it is counted' on any card", "Click 'See the records' to check the source", "A dash means there are too few records to say"], "Milestones on time: 8 of 10 = 80 %. Open the records to see which two were late.")],
  ["/documents", H("Documents", "One safe place for drawings, signed quotations, POs, certificates and photos.", ["Upload a file (PDF, photo, Excel, Word)", "Search and download", "Files are private: only people who may see them can open them"], "Upload the client's signed handover letter against the project.")],
  ["/notifications", H("Notifications", "Messages from the app: approvals, late items, new assignments.", ["Open one to go to the record", "Mark all as read"], "'Bill 4471 certified, ready to pay' is sent to Accounts here.")],
  ["/search", H("Search", "Find any client, project, PO, invoice or person by typing part of the name or number.", ["Type and press Enter", "Click a result to open it"], "Type 'Frido' to find the client, their quotations and their invoices.")],

  ["/projects", H("Projects", "All the projects you are named on, with their stage, dates and progress.", ["Open a project", "See which are late or over budget", "Owner, Management or Admin can start a new one from an accepted quotation"], "Open 'Frido Showroom' to see its tasks, reports, money and documents.")],
  ["/projects/tasks", H("Tasks", "Every task on every project you can see, with its person, date and health.", ["Filter by project, person or status", "Update progress and actual quantity", "Mark a task Blocked (a reason is needed)"], "'False ceiling, Zone B: planned 400 sq ft, done 250'. Status: At risk.")],
  ["/projects/:id", H("Project", "Everything about one project: plan, tasks, money, documents and reports.", ["Tabs: Overview, Milestones, Tasks, Financials, Documents and more", "Press Readiness to run the launch checklist", "Financials shows the forecast final cost and lets you update the estimate still to be spent", "Moving the end date needs a written reason: the first date is kept"], "On Financials, forecast cost Rs. 9.2 L against a budget of Rs. 8 L: the project is heading over budget.")],
  ["/site-reports", H("Daily Site Reports", "The morning and evening report from each site: people, work done, photos, material status.", ["Send the morning update (by 10:00)", "Send the evening report with photos (by 7 PM)", "Project Managers read them and see problems at once"], "Morning: 12 people, plan: plastering Zone A, material green. Evening: 85 % plastering done, 3 photos.")],
  ["/resources", H("Manpower", "How many people each trade needs on each project, and how many actually came.", ["Add a need: trade, how many, which days", "Confirm who will come (a note is needed) and name a backup", "Record each day: planned, came, late, and why", "See how reliable each vendor has been"], "Need 6 carpenters from 3 to 10 March. On day 2 only 4 came: write 'Crew short, vendor had another job', and the coordinator gets an action.")],
  ["/transfers", H("Transfers", "Moving material or people between sites or from the warehouse.", ["Raise a transfer", "Approve and receive it", "See where things are"], "Move 20 sheets of plywood from the Thane store to the Andheri site.")],
  ["/extra-work", H("Extra Work", "Work outside the signed scope, from the client or from an emergency, with the client's approval and billing.", ["Pick the kind: Chargeable, Included, Emergency, DSC's own rework or Concession", "Price it and send it to the client", "Start only when it says 'Client approved'", "Verify the finished work so Accounts can bill it"], "Client asks for one more glass partition. Price Rs. 42,000, client approves in the portal, then work starts.")],
  ["/bills-to-certify", H("Bills to Certify", "Vendor bills waiting for the Project Manager to confirm the work was really done.", ["Check challan, measurement and invoice", "Tick the box and Certify", "Accounts can pay only after this"], "Carpenter's bill for 120 sq ft of panelling. Measure on site, then Certify.")],
  ["/workforce/attendance", H("Attendance", "Who came to work and where. Phones must be close to the site.", ["Mark your own attendance (Office or a site)", "A supervisor can mark workers by hand when a phone has no signal", "See the month for each person"], "Stand within 20 metres of the site, press Mark attendance. Too far? It says how many metres away you are.")],
  ["/workforce/workers", H("Workers", "Your own daily-wage and monthly workers with their trade, wage and site.", ["Add a worker and choose the site", "Create a phone login so he can mark attendance", "Edit or deactivate"], "Add 'Ramesh, mason, Rs. 800 per day, Andheri site' and give him a phone login.")],
  ["/workforce/labour", H("Labour Cost", "What the site labour has cost per project.", ["See cost by project and month"], "Check that labour for the Andheri site matches the plan.")],
  ["/workforce/contractors", H("Contractors", "Outside labour contractors. This is switched off at DSC: outside firms are vendors.", ["Use Vendors instead"], "Add your carpenter under Vendors with the trade 'Carpenter'.")],
  ["/closure", H("Project Closure", "The 15-item checklist to close a project after handover.", ["Upload the document for each item", "Four items tick by themselves", "Management approves and closes the project"], "Upload the handover letter, snag certificate and warranty papers within 15 days.")],
  ["/scorecards", H("Scorecards", "A score out of 100 for each finished project, and the average for each manager.", ["Record the client rating, rework and safety", "See scores by Project Manager and Supervisor"], "Client rating 4/5, no safety issue, a little rework: the project scores 86.")],
  ["/support", H("Customer Support", "Client complaints and snag requests, with a deadline.", ["Open a ticket", "Assign it and close it within 7 days"], "'Tap leaking in Bathroom 2' is logged, assigned to the supervisor and closed with a photo.")],
  ["/feasibility/:scope/:id", H("Feasibility / Launch checklist", "Before accepting a job (8 questions) and before starting it (11 steps), confirm that DSC can really do it.", ["Answer each question with a note: who confirmed it and how", "Owner, Management or Admin decide: Accept, Accept with conditions, or Renegotiate / decline", "A late launch step is chased automatically"], "'Is the site accessible for material?': 'Yes, confirmed with the client's facility manager on 4 March'.")],

  ["/crm/clients", H("Clients", "Your clients with their contact details, projects, quotations, POs and invoices.", ["Add a client", "Open one to see their whole account", "Give a client a portal login"], "Add 'Frido, Surat' with GSTIN and address.")],
  ["/crm/clients/:id", H("Client", "One client's whole story: contact, projects, quotations, purchase orders and what they owe.", ["Add the client's PO with its value and file", "See per PO: billed, received, left to bill, left to collect", "Press 'Bill against this PO' to start an invoice", "Give the client a portal login"], "Client's PO 4500123 for Rs. 20 L. Billed Rs. 12 L, received Rs. 8 L: Rs. 8 L still to bill.")],
  ["/crm/leads", H("Leads", "The enquiry pipeline. Switched off at DSC until there is a sales team.", ["Add clients directly under Clients"], "Add the client directly instead.")],
  ["/crm/follow-ups", H("Follow-ups", "Reminders to call people. Switched off together with Leads.", ["Use Actions & Blockers for reminders"], "Create an action 'Call Mr Shah on Friday'.")],
  ["/crm/site-visits", H("Site Visits", "Visits to measure or inspect a site.", ["Schedule and record a visit"], "Visit on Tuesday to measure the shop before the BOQ.")],
  ["/sales/boq", H("Bill of Quantities", "The list of work, quantities and costs behind a quotation.", ["Make a BOQ for a client", "Import the client's own Excel", "Enter length and width with Measure", "Type costs and profit %: the selling rate is worked out"], "Import the client's Excel, add DSC's cost per sq ft and 18 % profit, and the quotation total appears.")],
  ["/sales/boq/:id", H("BOQ", "One BOQ: its rows, costs, profit and approval.", ["Add and edit rows", "Press 'Remember these rates for the client'", "Submit for approval, then create the quotation", "After approval it is locked: use Revise to change it"], "Plywood 18 mm: 1,200 sq ft at Rs. 95 cost, 15 % profit, selling Rs. 109 per sq ft.")],
  ["/sales/quotations", H("Quotations", "The offers you send to clients, with their status.", ["Make one from an approved BOQ", "Send it and track Accepted or Rejected", "Download PDF with the DSC letterhead, or Excel"], "Send quotation QT-0042 and mark it Client accepted when the PO arrives.")],
  ["/sales/quotations/:id", H("Quotation", "One quotation: items, GST, payment terms, status.", ["Choose payment terms (for example 50 / 40 / 10)", "Submit for approval, then Mark as sent", "Run the Feasibility check", "Press Client accepted, then Convert to project"], "Payment terms: 50 % advance, 40 % material at site, 10 % on handover.")],
  ["/sales/rates", H("Client rates", "The rates and profit DSC uses for each client, remembered for next time.", ["View and change a client's rates", "The next BOQ offers 'use the same as last time?'"], "Frido: laminate Rs. 140 per sq ft, 15 % profit. Next BOQ uses them if you say yes.")],

  ["/procurement/requests", H("Purchase Requests", "The site asking for material.", ["Raise a request with items, quantity and the date needed (2 days ahead)", "The Project Manager approves it", "Procurement turns it into an order"], "Request 40 sheets of 18 mm ply for Andheri, needed by Friday.")],
  ["/procurement/orders", H("Purchase Orders", "Orders sent to vendors.", ["Make an order with vendor, project, items and delivery date", "Send to vendor the same day", "Track what has arrived"], "Order 40 sheets from Kalpana Plywood for delivery on the 12th.")],
  ["/procurement/orders/:id", H("Purchase Order", "One order: items, price, delivery and status.", ["Send to vendor", "See received quantities and bills against it"], "40 ordered, 25 received: 15 still to come.")],
  ["/procurement/vendors", H("Vendors", "Suppliers and outside firms: material suppliers, carpenters, electricians, painters.", ["Add a vendor with GSTIN, bank and what they supply", "Set the tier (First choice, Backup, Emergency), trades and crew size", "Give a vendor a portal login"], "Add 'Sai Electricals', trade Electrician, crew of 8, First choice.")],
  ["/procurement/deliveries", H("Deliveries", "Order lines that have not fully arrived, with need-by and promised dates.", ["See what is late or will be late", "Write the reason and the recovery plan", "Dates can be corrected"], "Tiles promised for the 10th but the site needs them on the 8th: write 'Supplier delay', plan 'collect from Thane store'.")],

  ["/inventory/stock", H("Stock", "What material you have in each warehouse.", ["See quantity and value", "Spot low stock"], "Cement: 80 bags in the Thane store.")],
  ["/inventory/materials", H("Materials", "The list of items you buy, with units and last cost.", ["Add a material", "Set minimum stock and reorder level"], "Add 'Plywood 18 mm', unit sheet, reorder at 20.")],
  ["/inventory/receipts", H("Material Receipts", "Recording material that arrived.", ["Enter received, damaged and rejected quantities", "Take a photo of the challan"], "40 sheets ordered, 38 good, 2 damaged: record 38 accepted, 2 damaged.")],
  ["/inventory/issues", H("Issues & Returns", "Giving material to a site, and taking back what is unused.", ["Issue to a project (cost goes to the project)", "Return unused material"], "Issue 10 sheets to Andheri. Return 2 unused sheets at the end.")],
  ["/inventory/movements", H("Stock Ledger", "Every stock movement in order, like a bank passbook.", ["See each receipt, issue, return and adjustment"], "Check why the Thane store shows 5 fewer bags than expected.")],
  ["/inventory/waste", H("Waste & Reconciliation", "Record waste, damage and offcuts, and check issued against used.", ["Record waste with a reason and a person to find out why", "Mark a reusable offcut (it stays in stock)", "See issued − returned − waste − still at site = used"], "Cut-offs of 6 sheets recorded as waste 'wrong measurement, Ravi to review'.")],
  ["/inventory/locations", H("Locations", "Your warehouses and store rooms.", ["Add a warehouse", "Link one to a site"], "Add 'Thane Main Store'.")],

  ["/finance", H("Finance overview", "The money picture: billed, received, owed, paid.", ["See totals and trends", "Jump to invoices, receivables or bills"], "Billed Rs. 40 L, received Rs. 31 L, Rs. 9 L still to collect.")],
  ["/finance/invoices", H("Invoices", "Bills raised to clients.", ["Make an invoice (choose the client, project and the client's PO)", "Send for approval, then to the client", "Download PDF"], "Invoice INV-0112 for Rs. 5 L against PO 4500123.")],
  ["/finance/invoices/new", H("New invoice", "Raise a new invoice to a client, tied to the client's PO and project.", ["Choose the client, project and the client's PO", "Billing above the PO is refused unless you write why", "Add lines, GST and due date"], "Total Rs. 6 L against a PO with Rs. 5 L left: write 'Extra partition approved by email 3 March'.")],
  ["/finance/invoices/:id", H("Invoice", "One invoice: items, payments and follow-ups.", ["Record a payment", "Add a follow-up after each call or visit, with the next step and date", "A promised date never marks it paid"], "Accounts head promises payment on the 20th. Record the promise and 'Call again on the 21st'.")],
  ["/finance/payments", H("Payments Received", "Money received from clients.", ["See every payment", "Record one against an invoice"], "Rs. 3 L received by NEFT on the 14th against INV-0112.")],
  ["/finance/profit", H("Company profit", "Revenue, gross profit, EBITDA and net profit from completed projects, month by month and year by year, plus what clients ordered and what we earned on it.", ["Pick the financial year (April to March)", "See each month and the year total", "Add depreciation, interest and tax for a month so Net profit is complete"], "A project completed in June adds its contract value and cost to June. Office costs and salaries come off to give EBITDA.")],
  ["/finance/receivables", H("Receivables", "Who owes DSC money and how late it is, with the last follow-up.", ["See ageing: current, 30, 60, 90 days", "See the last follow-up and any missed promise", "Open an invoice to follow up"], "Invoice 45 days late, promised on the 10th, not received: shown in red.")],
  ["/finance/bills", H("Vendor Bills", "Bills received from vendors and payments made.", ["Add a bill (a repeated or look-alike bill needs a reason)", "Wait for the Project Manager to certify", "Pay and record the payment"], "Vendor sends bill 2231 for Rs. 45,000. After certification, pay it.")],
  ["/finance/payables", H("Payables", "What DSC owes vendors, by due date.", ["See what is due this week", "Open a bill to pay"], "Plan next week's payments from this list.")],
  ["/finance/expenses", H("Expenses", "Small costs paid on site or in the office, with a photo of the bill.", ["Add an expense with a photo", "Accounts verifies it"], "Rs. 650 for fevicol, photo of the bill, charged to the Andheri project.")],

  ["/hr/employees", H("Employees", "Everyone on the payroll with details and salary structure.", ["Add or edit an employee", "Set designation, joining date, salary"], "Set Ravi's basic Rs. 25,000, HRA Rs. 10,000.")],
  ["/hr/leaves", H("Leave", "Leave requests and balances.", ["Apply for leave", "Approve or reject"], "Apply for 2 days casual leave from the 12th.")],
  ["/hr/payroll", H("Payroll", "Monthly salary calculation and payslips.", ["Run the month", "Check attendance and advances", "Approve and pay"], "Run March payroll after attendance is complete.")],
  ["/hr/advances", H("Advances", "Salary advances given to staff and how they are recovered.", ["Give an advance", "Set the monthly recovery"], "Advance Rs. 10,000 recovered at Rs. 2,500 per month.")],
  ["/hr/payslips", H("My Payslips", "Your own monthly payslips, only visible to you.", ["View and download"], "Download the March payslip.")],
  ["/hr/announcements", H("Announcements", "Messages from management to the whole team.", ["Post an announcement", "Read old ones"], "'Office closed on Holi'.")],

  ["/director-reports", H("Director Reports", "Weekly and monthly reports for the directors.", ["Open a report", "Download as PDF"], "Open the monthly report before the review meeting.")],
  ["/reports", H("Reports", "Standard reports, including the GST sales register for the accountant.", ["Pick a report and a date range", "Download"], "Download the March GST sales register for the CA.")],
  ["/whatsapp", H("WhatsApp", "A place to prepare WhatsApp messages. The app does not send them by itself yet.", ["Prepare a message and copy it"], "Prepare a reminder to a vendor.")],
  ["/marketing", H("Marketing", "Campaign and brand notes.", ["Keep campaign details in one place"], "Note the planned Diwali offer.")],

  ["/settings/team", H("Team & Users", "Everyone who can sign in, with their role.", ["Add a user (add the senior person first)", "Edit a role, reset a password, deactivate", "Give clients and vendors a portal login"], "Add 'Neha' as Designer with a temporary password.")],
  ["/settings/company", H("Company Settings", "DSC's name, GSTIN, bank, prefixes, GST, payment terms and approval limits.", ["Fill the details printed on every quotation and invoice", "Choose the resource coordinator", "Set approval limits"], "Enter GSTIN and bank details once: they print on every invoice.")],
  ["/settings/attendance", H("Attendance Location", "Where the office is and how close a person must be to mark attendance.", ["Press 'Use my current location' at the office", "Set the allowed distance (20 m)"], "Stand in the office, press the button, Save.")],
  ["/settings/roles", H("Roles", "What each role can see and do.", ["Read the permission table"], "Check that the Supervisor cannot see costs.")],
  ["/settings/import", H("Import", "Bring in clients, vendors or materials from Excel.", ["Upload the file and check the preview", "Import"], "Import your vendor list from Excel instead of typing it.")],
  ["/settings/terms", H("Terms Templates", "The terms and conditions printed on quotations and orders.", ["Edit the wording", "Save"], "Change the validity to 15 days.")],
  ["/settings/time-limits", H("Time Limit Settings", "How many hours each task may wait before it turns red.", ["Change a limit", "Choose who is told"], "Make 'quotation after visit' 24 hours.")],
  ["/settings/automation", H("Automation", "Daily jobs and reminders that run by themselves.", ["See what runs and when"], "The 7 AM reminder for late items.")],
  ["/settings/audit", H("Audit Log", "A record of who changed what and when. It cannot be edited.", ["Search by person or record"], "See who moved the end date of a project and why.")],
  ["/settings/whatsapp", H("WhatsApp Settings", "Settings for WhatsApp messages.", ["View the settings"], "Nothing is sent until a provider is connected.")],
];

const FALLBACK: Help = H("This screen", "This part of the app. Everything you see here is limited to what your role allows.", ["Use the menu on the left to move around", "Use the search bar to find a client, project or invoice", "Ask your Admin if something you need is missing"], "Open the Dashboard to see what needs you today.");

const segs = (p: string) => p.split("?")[0].split("/").filter(Boolean);

/** The help for an address: the most specific match, else the closest parent, else a general note. */
export function helpFor(pathname: string): Help {
  const path = segs(pathname);
  let best: { score: number; help: Help } | null = null;
  for (const [pattern, help] of ENTRIES) {
    const pat = segs(pattern);
    if (pat.length > path.length) continue;
    let ok = true;
    for (let i = 0; i < pat.length; i++) if (pat[i][0] !== ":" && pat[i] !== path[i]) { ok = false; break; }
    if (!ok) continue;
    // an exact-length match beats a parent; more fixed words beat more wildcards
    const score = pat.length * 10 + (pat.length === path.length ? 5 : 0) + pat.filter((s) => s[0] !== ":").length;
    if (!best || score > best.score) best = { score, help };
  }
  return best?.help ?? FALLBACK;
}

/** Every address that has its own help text (used by a test to make sure no menu item is left without one). */
export const HELP_PATTERNS = ENTRIES.map(([p]) => p);
