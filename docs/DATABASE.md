# Database

> Generated from `prisma/schema.prisma` by `npm run docs` – do not edit by hand.

PostgreSQL, managed with Prisma migrations (`prisma/migrations`). **60 tables, 29 enums.**

## Design rules

- **Multi-tenant:** every business table carries `companyId`; every query is filtered by it, so one company can never read another's data.
- **Money** is stored as `Decimal(14,2)` – never floating point. Quantities use `Decimal(12–14,3)`.
- **Soft delete** (`deletedAt`) on records that other records refer to (clients, leads, projects, vendors, quotations, invoices, BOQs, workers, employees…). History is never lost.
- **Stock is a ledger:** `StockBalance` is only ever changed together with an `InventoryTransaction` row inside one database transaction.
- **Numbering** (`QT-00045`, `PO-00031`, `INV-…`) comes from `Sequence`, incremented atomically inside the saving transaction.
- **Audit:** `AuditLog` is append-only; there is no code path that edits or deletes it.
- Foreign keys and indexes exist on every lookup column used by the screens (company + status, company + date, company + project…).

## Company, users & security

### Company

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `name` | String |  |
| `slug` | String | unique |
| `createdAt` | DateTime |  |
| `updatedAt` | DateTime |  |
| `settings` | CompanySettings? → CompanySettings | optional |
| `users` | User[] → User (many) |  |

### CompanySettings

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String | unique |
| `company` | Company → Company |  |
| `legalName` | String? | optional |
| `logoUrl` | String? | optional |
| `address` | String? | optional |
| `phone` | String? | optional |
| `email` | String? | optional |
| `website` | String? | optional |
| `gstin` | String? | optional |
| `pan` | String? | optional |
| `bankName` | String? | optional |
| `bankAccountNo` | String? | optional |
| `bankIfsc` | String? | optional |
| `bankBranch` | String? | optional |
| `invoicePrefix` | String |  |
| `quotationPrefix` | String |  |
| `poPrefix` | String |  |
| `defaultTaxPercent` | Decimal |  |
| `approvalLevel1` | Decimal |  |
| `approvalLevel2` | Decimal |  |
| `payrollConfig` | Json? | optional |
| `notificationPrefs` | Json? | optional |
| `whatsappConfig` | Json? | optional |
| `updatedAt` | DateTime |  |

### Sequence

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `key` | String |  |
| `value` | Int |  |

Indexes: `unique: companyId, key`

### Permission

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `key` | String | unique |
| `description` | String? | optional |
| `roles` | RolePermission[] → RolePermission (many) |  |

### RolePermission

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `role` | RoleKey |  |
| `permissionId` | String |  |
| `permission` | Permission → Permission |  |

Indexes: `unique: companyId, role, permissionId`, `index: companyId, role`

### User

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `company` | Company → Company |  |
| `email` | String |  |
| `name` | String |  |
| `phone` | String? | optional |
| `passwordHash` | String |  |
| `role` | RoleKey |  |
| `isActive` | Boolean |  |
| `lastLoginAt` | DateTime? | optional |
| `clientId` | String? | optional |
| `vendorId` | String? | optional |
| `workerId` | String? | optional |
| `createdAt` | DateTime |  |
| `updatedAt` | DateTime |  |
| `deletedAt` | DateTime? | optional |
| `employee` | Employee? → Employee | optional |
| `notifications` | Notification[] → Notification (many) |  |

Indexes: `unique: companyId, email`, `index: companyId, role`

### AuditLog

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `userId` | String? | optional |
| `userName` | String? | optional |
| `action` | String |  |
| `entityType` | String |  |
| `entityId` | String? | optional |
| `summary` | String |  |
| `oldValue` | Json? | optional |
| `newValue` | Json? | optional |
| `ip` | String? | optional |
| `userAgent` | String? | optional |
| `createdAt` | DateTime |  |

Indexes: `index: companyId, createdAt`, `index: companyId, entityType, entityId`

### Notification

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `userId` | String |  |
| `user` | User → User |  |
| `type` | NotificationType |  |
| `title` | String |  |
| `body` | String? | optional |
| `link` | String? | optional |
| `readAt` | DateTime? | optional |
| `dedupeKey` | String? | optional |
| `createdAt` | DateTime |  |

Indexes: `unique: userId, dedupeKey`, `index: userId, readAt, createdAt`

### Approval

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `type` | ApprovalType |  |
| `entityType` | String |  |
| `entityId` | String |  |
| `title` | String |  |
| `amount` | Decimal? | optional |
| `status` | ApprovalStatus |  |
| `requestedById` | String |  |
| `requiredRole` | RoleKey |  |
| `decidedById` | String? | optional |
| `decidedAt` | DateTime? | optional |
| `remarks` | String? | optional |
| `createdAt` | DateTime |  |
| `steps` | ApprovalStep[] → ApprovalStep (many) |  |

Indexes: `index: companyId, status`, `index: companyId, entityType, entityId`

### ApprovalStep

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `approvalId` | String |  |
| `approval` | Approval → Approval |  |
| `stepNo` | Int |  |
| `role` | RoleKey |  |
| `status` | ApprovalStatus |  |
| `userId` | String? | optional |
| `decidedAt` | DateTime? | optional |
| `remarks` | String? | optional |

### TermsAndConditions

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `name` | String |  |
| `kind` | String |  |
| `body` | String |  |
| `isDefault` | Boolean |  |

Indexes: `index: companyId, kind`

### Announcement

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `title` | String |  |
| `body` | String |  |
| `pinned` | Boolean |  |
| `createdById` | String? | optional |
| `createdAt` | DateTime |  |
| `expiresAt` | DateTime? | optional |

Indexes: `index: companyId, createdAt`

## CRM

### Client

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `code` | String |  |
| `name` | String |  |
| `companyName` | String? | optional |
| `phone` | String? | optional |
| `email` | String? | optional |
| `address` | String? | optional |
| `billingAddress` | String? | optional |
| `gstin` | String? | optional |
| `pan` | String? | optional |
| `projectManagerId` | String? | optional |
| `notes` | String? | optional |
| `createdAt` | DateTime |  |
| `updatedAt` | DateTime |  |
| `deletedAt` | DateTime? | optional |
| `leads` | Lead[] → Lead (many) |  |
| `projects` | Project[] → Project (many) |  |
| `quotations` | Quotation[] → Quotation (many) |  |
| `invoices` | Invoice[] → Invoice (many) |  |
| `tickets` | SupportTicket[] → SupportTicket (many) |  |
| `siteVisits` | SiteVisit[] → SiteVisit (many) |  |

Indexes: `unique: companyId, code`, `index: companyId, name`

### Lead

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `code` | String |  |
| `name` | String |  |
| `companyName` | String? | optional |
| `phone` | String? | optional |
| `whatsapp` | String? | optional |
| `email` | String? | optional |
| `source` | String? | optional |
| `segment` | SegmentType |  |
| `projectType` | String? | optional |
| `location` | String? | optional |
| `estimatedValue` | Decimal? | optional |
| `requirement` | String? | optional |
| `assignedToId` | String? | optional |
| `stage` | LeadStage |  |
| `priority` | Priority |  |
| `nextFollowUp` | DateTime? | optional |
| `lostReason` | String? | optional |
| `notes` | String? | optional |
| `clientId` | String? | optional |
| `client` | Client? → Client | optional |
| `createdAt` | DateTime |  |
| `updatedAt` | DateTime |  |
| `deletedAt` | DateTime? | optional |
| `activities` | LeadActivity[] → LeadActivity (many) |  |
| `siteVisits` | SiteVisit[] → SiteVisit (many) |  |
| `quotations` | Quotation[] → Quotation (many) |  |

Indexes: `unique: companyId, code`, `index: companyId, stage`, `index: companyId, nextFollowUp`, `index: companyId, assignedToId`

### LeadActivity

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `leadId` | String |  |
| `lead` | Lead → Lead |  |
| `kind` | String |  |
| `body` | String? | optional |
| `userId` | String? | optional |
| `createdAt` | DateTime |  |

Indexes: `index: leadId, createdAt`

### SiteVisit

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `leadId` | String? | optional |
| `lead` | Lead? → Lead | optional |
| `clientId` | String? | optional |
| `client` | Client? → Client | optional |
| `projectId` | String? | optional |
| `siteAddress` | String |  |
| `visitDate` | DateTime |  |
| `visitTime` | String? | optional |
| `assignedToId` | String? | optional |
| `siteCondition` | String? | optional |
| `measurements` | String? | optional |
| `requirements` | String? | optional |
| `estimatedArea` | Decimal? | optional |
| `notes` | String? | optional |
| `followUpDate` | DateTime? | optional |
| `completed` | Boolean |  |
| `createdAt` | DateTime |  |
| `updatedAt` | DateTime |  |

Indexes: `index: companyId, visitDate`

### MarketingCampaign

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `name` | String |  |
| `channel` | String |  |
| `startDate` | DateTime? | optional |
| `endDate` | DateTime? | optional |
| `spend` | Decimal |  |
| `notes` | String? | optional |
| `createdAt` | DateTime |  |

Indexes: `index: companyId, channel`

### WhatsAppConversation

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `contactName` | String |  |
| `phone` | String |  |
| `leadId` | String? | optional |
| `clientId` | String? | optional |
| `assignedToId` | String? | optional |
| `unread` | Int |  |
| `lastMessageAt` | DateTime |  |
| `createdAt` | DateTime |  |
| `messages` | WhatsAppMessage[] → WhatsAppMessage (many) |  |

Indexes: `unique: companyId, phone`, `index: companyId, lastMessageAt`

### WhatsAppMessage

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `conversationId` | String |  |
| `conversation` | WhatsAppConversation → WhatsAppConversation |  |
| `direction` | WhatsAppDirection |  |
| `body` | String |  |
| `template` | String? | optional |
| `status` | String |  |
| `externalId` | String? | optional |
| `sentById` | String? | optional |
| `createdAt` | DateTime |  |

Indexes: `index: conversationId, createdAt`

## Sales

### Quotation

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `number` | String |  |
| `revision` | Int |  |
| `clientId` | String |  |
| `client` | Client → Client |  |
| `leadId` | String? | optional |
| `lead` | Lead? → Lead | optional |
| `projectId` | String? | optional |
| `boqId` | String? | optional |
| `title` | String? | optional |
| `date` | DateTime |  |
| `validUntil` | DateTime? | optional |
| `preparedById` | String? | optional |
| `status` | QuotationStatus |  |
| `subtotal` | Decimal |  |
| `discountPct` | Decimal |  |
| `discountAmount` | Decimal |  |
| `taxAmount` | Decimal |  |
| `total` | Decimal |  |
| `terms` | String? | optional |
| `paymentTerms` | String? | optional |
| `notes` | String? | optional |
| `createdAt` | DateTime |  |
| `updatedAt` | DateTime |  |
| `deletedAt` | DateTime? | optional |
| `items` | QuotationItem[] → QuotationItem (many) |  |
| `revisions` | QuotationRevision[] → QuotationRevision (many) |  |
| `invoices` | Invoice[] → Invoice (many) |  |

Indexes: `unique: companyId, number`, `index: companyId, status`, `index: companyId, clientId`

### QuotationItem

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `quotationId` | String |  |
| `quotation` | Quotation → Quotation |  |
| `sortOrder` | Int |  |
| `category` | BoqCategory |  |
| `description` | String |  |
| `unit` | String |  |
| `quantity` | Decimal |  |
| `rate` | Decimal |  |
| `taxPercent` | Decimal |  |
| `amount` | Decimal |  |

### QuotationRevision

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `quotationId` | String |  |
| `quotation` | Quotation → Quotation |  |
| `revision` | Int |  |
| `total` | Decimal |  |
| `snapshot` | Json |  |
| `reason` | String? | optional |
| `createdById` | String? | optional |
| `createdAt` | DateTime |  |

Indexes: `index: quotationId, revision`

### Boq

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `number` | String |  |
| `revision` | Int |  |
| `projectId` | String? | optional |
| `project` | Project? → Project | optional |
| `quotationId` | String? | optional |
| `title` | String |  |
| `status` | BoqStatus |  |
| `notes` | String? | optional |
| `createdAt` | DateTime |  |
| `updatedAt` | DateTime |  |
| `deletedAt` | DateTime? | optional |
| `items` | BoqItem[] → BoqItem (many) |  |

Indexes: `unique: companyId, number`, `index: companyId, projectId`

### BoqItem

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `boqId` | String |  |
| `boq` | Boq → Boq |  |
| `sortOrder` | Int |  |
| `category` | BoqCategory |  |
| `subcategory` | String? | optional |
| `item` | String |  |
| `description` | String? | optional |
| `specification` | String? | optional |
| `unit` | String |  |
| `quantity` | Decimal |  |
| `materialCost` | Decimal |  |
| `labourCost` | Decimal |  |
| `otherCost` | Decimal |  |
| `sellingRate` | Decimal |  |
| `materialId` | String? | optional |
| `material` | Material? → Material | optional |
| `supplierId` | String? | optional |
| `estimatedCost` | Decimal |  |
| `total` | Decimal |  |

Indexes: `index: boqId`, `index: materialId`

## Projects

### Project

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `code` | String |  |
| `name` | String |  |
| `clientId` | String |  |
| `client` | Client → Client |  |
| `segment` | SegmentType |  |
| `siteAddress` | String? | optional |
| `startDate` | DateTime? | optional |
| `plannedEndDate` | DateTime? | optional |
| `actualEndDate` | DateTime? | optional |
| `projectManagerId` | String? | optional |
| `designerId` | String? | optional |
| `siteEngineerId` | String? | optional |
| `supervisorId` | String? | optional |
| `contractValue` | Decimal |  |
| `budget` | Decimal |  |
| `status` | ProjectStatus |  |
| `progress` | Int |  |
| `quotationId` | String? | optional |
| `createdAt` | DateTime |  |
| `updatedAt` | DateTime |  |
| `deletedAt` | DateTime? | optional |
| `tasks` | ProjectTask[] → ProjectTask (many) |  |
| `milestones` | ProjectMilestone[] → ProjectMilestone (many) |  |
| `boqs` | Boq[] → Boq (many) |  |
| `purchaseRequests` | PurchaseRequest[] → PurchaseRequest (many) |  |
| `purchaseOrders` | PurchaseOrder[] → PurchaseOrder (many) |  |
| `expenses` | Expense[] → Expense (many) |  |
| `invoices` | Invoice[] → Invoice (many) |  |
| `materialIssues` | MaterialIssue[] → MaterialIssue (many) |  |
| `members` | ProjectMember[] → ProjectMember (many) |  |
| `tickets` | SupportTicket[] → SupportTicket (many) |  |

Indexes: `unique: companyId, code`, `index: companyId, status`, `index: companyId, clientId`

### ProjectMember

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `projectId` | String |  |
| `project` | Project → Project |  |
| `userId` | String |  |
| `roleLabel` | String? | optional |

Indexes: `unique: projectId, userId`

### ProjectTask

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `code` | String |  |
| `projectId` | String |  |
| `project` | Project → Project |  |
| `name` | String |  |
| `description` | String? | optional |
| `assignedToId` | String? | optional |
| `workerId` | String? | optional |
| `priority` | Priority |  |
| `startDate` | DateTime? | optional |
| `dueDate` | DateTime? | optional |
| `status` | TaskStatus |  |
| `progress` | Int |  |
| `dependsOnId` | String? | optional |
| `createdAt` | DateTime |  |
| `updatedAt` | DateTime |  |
| `comments` | TaskComment[] → TaskComment (many) |  |

Indexes: `unique: companyId, code`, `index: companyId, projectId`, `index: companyId, assignedToId, status`, `index: companyId, dueDate`

### TaskComment

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `taskId` | String |  |
| `task` | ProjectTask → ProjectTask |  |
| `userId` | String |  |
| `body` | String |  |
| `createdAt` | DateTime |  |

### ProjectMilestone

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `projectId` | String |  |
| `project` | Project → Project |  |
| `name` | String |  |
| `dueDate` | DateTime? | optional |
| `completedAt` | DateTime? | optional |
| `billingPct` | Decimal |  |
| `clientApproved` | Boolean |  |

Indexes: `index: projectId`

### SupportTicket

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `number` | String |  |
| `clientId` | String |  |
| `client` | Client → Client |  |
| `projectId` | String? | optional |
| `project` | Project? → Project | optional |
| `subject` | String |  |
| `description` | String? | optional |
| `priority` | Priority |  |
| `isWarranty` | Boolean |  |
| `assignedToId` | String? | optional |
| `status` | TicketStatus |  |
| `resolution` | String? | optional |
| `createdAt` | DateTime |  |
| `updatedAt` | DateTime |  |
| `claims` | WarrantyClaim[] → WarrantyClaim (many) |  |

Indexes: `unique: companyId, number`, `index: companyId, status`

### WarrantyClaim

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `ticketId` | String |  |
| `ticket` | SupportTicket → SupportTicket |  |
| `item` | String |  |
| `approved` | Boolean? | optional |
| `notes` | String? | optional |
| `createdAt` | DateTime |  |

## Procurement & inventory

### Vendor

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `code` | String |  |
| `name` | String |  |
| `contactPerson` | String? | optional |
| `phone` | String? | optional |
| `whatsapp` | String? | optional |
| `email` | String? | optional |
| `address` | String? | optional |
| `gstin` | String? | optional |
| `pan` | String? | optional |
| `bankDetails` | String? | optional |
| `categories` | String? | optional |
| `rating` | Int? | optional |
| `notes` | String? | optional |
| `createdAt` | DateTime |  |
| `updatedAt` | DateTime |  |
| `deletedAt` | DateTime? | optional |
| `purchaseOrders` | PurchaseOrder[] → PurchaseOrder (many) |  |
| `bills` | VendorBill[] → VendorBill (many) |  |
| `payments` | VendorPayment[] → VendorPayment (many) |  |
| `materials` | Material[] → Material (many) |  |

Indexes: `unique: companyId, code`, `index: companyId, name`

### Material

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `sku` | String |  |
| `name` | String |  |
| `category` | BoqCategory |  |
| `unit` | String |  |
| `minStock` | Decimal |  |
| `reorderLevel` | Decimal |  |
| `purchaseCost` | Decimal |  |
| `vendorId` | String? | optional |
| `vendor` | Vendor? → Vendor | optional |
| `createdAt` | DateTime |  |
| `updatedAt` | DateTime |  |
| `deletedAt` | DateTime? | optional |
| `stock` | StockBalance[] → StockBalance (many) |  |
| `transactions` | InventoryTransaction[] → InventoryTransaction (many) |  |
| `boqItems` | BoqItem[] → BoqItem (many) |  |

Indexes: `unique: companyId, sku`, `index: companyId, name`

### Warehouse

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `name` | String |  |
| `type` | LocationType |  |
| `projectId` | String? | optional |
| `address` | String? | optional |
| `isActive` | Boolean |  |
| `stock` | StockBalance[] → StockBalance (many) |  |

Indexes: `index: companyId, type`

### StockBalance

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `materialId` | String |  |
| `material` | Material → Material |  |
| `locationId` | String |  |
| `location` | Warehouse → Warehouse |  |
| `quantity` | Decimal |  |
| `reserved` | Decimal |  |
| `avgCost` | Decimal |  |

Indexes: `unique: materialId, locationId`, `index: companyId, locationId`

### InventoryTransaction

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `type` | InventoryTxnType |  |
| `materialId` | String |  |
| `material` | Material → Material |  |
| `fromLocationId` | String? | optional |
| `toLocationId` | String? | optional |
| `quantity` | Decimal |  |
| `unitCost` | Decimal |  |
| `projectId` | String? | optional |
| `refType` | String? | optional |
| `refId` | String? | optional |
| `note` | String? | optional |
| `createdById` | String? | optional |
| `createdAt` | DateTime |  |

Indexes: `index: companyId, materialId, createdAt`, `index: companyId, projectId`, `index: companyId, createdAt`

### PurchaseRequest

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `number` | String |  |
| `projectId` | String? | optional |
| `project` | Project? → Project | optional |
| `requestedById` | String |  |
| `requiredDate` | DateTime? | optional |
| `reason` | String? | optional |
| `priority` | Priority |  |
| `status` | PurchaseRequestStatus |  |
| `createdAt` | DateTime |  |
| `updatedAt` | DateTime |  |
| `items` | PurchaseRequestItem[] → PurchaseRequestItem (many) |  |

Indexes: `unique: companyId, number`, `index: companyId, status`

### PurchaseRequestItem

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `requestId` | String |  |
| `request` | PurchaseRequest → PurchaseRequest |  |
| `materialId` | String? | optional |
| `description` | String |  |
| `unit` | String |  |
| `quantity` | Decimal |  |
| `boqItemId` | String? | optional |

### PurchaseOrder

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `number` | String |  |
| `vendorId` | String |  |
| `vendor` | Vendor → Vendor |  |
| `projectId` | String? | optional |
| `project` | Project? → Project | optional |
| `requestId` | String? | optional |
| `status` | PoStatus |  |
| `orderDate` | DateTime |  |
| `deliveryDate` | DateTime? | optional |
| `paymentTerms` | String? | optional |
| `subtotal` | Decimal |  |
| `discountAmount` | Decimal |  |
| `taxAmount` | Decimal |  |
| `total` | Decimal |  |
| `notes` | String? | optional |
| `createdById` | String? | optional |
| `createdAt` | DateTime |  |
| `updatedAt` | DateTime |  |
| `items` | PurchaseOrderItem[] → PurchaseOrderItem (many) |  |
| `receipts` | MaterialReceipt[] → MaterialReceipt (many) |  |
| `bills` | VendorBill[] → VendorBill (many) |  |

Indexes: `unique: companyId, number`, `index: companyId, status`, `index: companyId, vendorId`

### PurchaseOrderItem

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `poId` | String |  |
| `po` | PurchaseOrder → PurchaseOrder |  |
| `materialId` | String? | optional |
| `description` | String |  |
| `unit` | String |  |
| `quantity` | Decimal |  |
| `receivedQty` | Decimal |  |
| `rate` | Decimal |  |
| `taxPercent` | Decimal |  |
| `amount` | Decimal |  |
| `boqItemId` | String? | optional |

### MaterialReceipt

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `number` | String |  |
| `poId` | String |  |
| `po` | PurchaseOrder → PurchaseOrder |  |
| `locationId` | String |  |
| `deliveryDate` | DateTime |  |
| `challanNo` | String? | optional |
| `vehicleNo` | String? | optional |
| `remarks` | String? | optional |
| `receivedById` | String? | optional |
| `createdAt` | DateTime |  |
| `items` | MaterialReceiptItem[] → MaterialReceiptItem (many) |  |

Indexes: `unique: companyId, number`

### MaterialReceiptItem

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `receiptId` | String |  |
| `receipt` | MaterialReceipt → MaterialReceipt |  |
| `poItemId` | String |  |
| `materialId` | String? | optional |
| `orderedQty` | Decimal |  |
| `receivedQty` | Decimal |  |
| `damagedQty` | Decimal |  |
| `rejectedQty` | Decimal |  |
| `acceptedQty` | Decimal |  |

### MaterialIssue

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `number` | String |  |
| `projectId` | String |  |
| `project` | Project → Project |  |
| `fromLocationId` | String |  |
| `toLocationId` | String |  |
| `issuedById` | String? | optional |
| `receivedBy` | String? | optional |
| `purpose` | String? | optional |
| `date` | DateTime |  |
| `createdAt` | DateTime |  |
| `items` | MaterialIssueItem[] → MaterialIssueItem (many) |  |

Indexes: `unique: companyId, number`, `index: companyId, projectId`

### MaterialIssueItem

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `issueId` | String |  |
| `issue` | MaterialIssue → MaterialIssue |  |
| `materialId` | String |  |
| `quantity` | Decimal |  |
| `unitCost` | Decimal |  |

## People & payroll

### Employee

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `userId` | String? | optional, unique |
| `user` | User? → User | optional |
| `code` | String |  |
| `name` | String |  |
| `email` | String? | optional |
| `phone` | String? | optional |
| `designation` | String? | optional |
| `department` | String? | optional |
| `joiningDate` | DateTime? | optional |
| `managerId` | String? | optional |
| `workLocation` | String? | optional |
| `emergencyContact` | String? | optional |
| `status` | EmploymentStatus |  |
| `createdAt` | DateTime |  |
| `updatedAt` | DateTime |  |
| `deletedAt` | DateTime? | optional |
| `salaryStructure` | SalaryStructure? → SalaryStructure | optional |
| `payslips` | Payslip[] → Payslip (many) |  |
| `leaves` | Leave[] → Leave (many) |  |

Indexes: `unique: companyId, code`, `index: companyId, name`

### SalaryStructure

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `employeeId` | String | unique |
| `employee` | Employee → Employee |  |
| `basic` | Decimal |  |
| `hra` | Decimal |  |
| `allowances` | Decimal |  |
| `deductions` | Decimal |  |
| `updatedAt` | DateTime |  |

### Payslip

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `employeeId` | String |  |
| `employee` | Employee → Employee |  |
| `month` | Int |  |
| `year` | Int |  |
| `workingDays` | Int |  |
| `presentDays` | Decimal |  |
| `basic` | Decimal |  |
| `hra` | Decimal |  |
| `allowances` | Decimal |  |
| `overtime` | Decimal |  |
| `incentives` | Decimal |  |
| `bonus` | Decimal |  |
| `deductions` | Decimal |  |
| `leaveDeduction` | Decimal |  |
| `netSalary` | Decimal |  |
| `createdAt` | DateTime |  |

Indexes: `unique: employeeId, month, year`, `index: companyId, year, month`

### Leave

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `employeeId` | String |  |
| `employee` | Employee → Employee |  |
| `fromDate` | DateTime |  |
| `toDate` | DateTime |  |
| `days` | Decimal |  |
| `reason` | String? | optional |
| `paid` | Boolean |  |
| `status` | LeaveStatus |  |
| `decidedById` | String? | optional |
| `decisionNote` | String? | optional |
| `createdAt` | DateTime |  |

Indexes: `index: companyId, status`, `index: employeeId, fromDate`

### Worker

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `code` | String |  |
| `name` | String |  |
| `phone` | String? | optional |
| `trade` | WorkerTrade |  |
| `skill` | String? | optional |
| `contractorId` | String? | optional |
| `contractor` | Contractor? → Contractor | optional |
| `currentProjectId` | String? | optional |
| `wageType` | WageType |  |
| `dailyWage` | Decimal |  |
| `monthlyWage` | Decimal |  |
| `joiningDate` | DateTime? | optional |
| `emergencyContact` | String? | optional |
| `isActive` | Boolean |  |
| `createdAt` | DateTime |  |
| `updatedAt` | DateTime |  |
| `deletedAt` | DateTime? | optional |
| `attendance` | Attendance[] → Attendance (many) |  |

Indexes: `unique: companyId, code`, `index: companyId, trade`

### Contractor

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `name` | String |  |
| `contactPerson` | String? | optional |
| `phone` | String? | optional |
| `email` | String? | optional |
| `gstin` | String? | optional |
| `rating` | Int? | optional |
| `notes` | String? | optional |
| `createdAt` | DateTime |  |
| `updatedAt` | DateTime |  |
| `deletedAt` | DateTime? | optional |
| `workers` | Worker[] → Worker (many) |  |
| `workOrders` | WorkOrder[] → WorkOrder (many) |  |
| `payments` | ContractorPayment[] → ContractorPayment (many) |  |

Indexes: `index: companyId, name`

### WorkOrder

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `number` | String |  |
| `contractorId` | String |  |
| `contractor` | Contractor → Contractor |  |
| `projectId` | String? | optional |
| `title` | String |  |
| `scope` | String? | optional |
| `rateNote` | String? | optional |
| `amount` | Decimal |  |
| `status` | String |  |
| `startDate` | DateTime? | optional |
| `endDate` | DateTime? | optional |
| `createdAt` | DateTime |  |
| `payments` | ContractorPayment[] → ContractorPayment (many) |  |

Indexes: `unique: companyId, number`, `index: companyId, contractorId`, `index: companyId, projectId`

### ContractorPayment

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `contractorId` | String |  |
| `contractor` | Contractor → Contractor |  |
| `workOrderId` | String? | optional |
| `workOrder` | WorkOrder? → WorkOrder | optional |
| `projectId` | String? | optional |
| `date` | DateTime |  |
| `amount` | Decimal |  |
| `method` | PaymentMethod |  |
| `reference` | String? | optional |
| `notes` | String? | optional |
| `createdAt` | DateTime |  |

Indexes: `index: companyId, date`, `index: companyId, projectId`

### Attendance

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `date` | DateTime |  |
| `workerId` | String? | optional |
| `worker` | Worker? → Worker | optional |
| `employeeId` | String? | optional |
| `projectId` | String? | optional |
| `status` | AttendanceStatus |  |
| `method` | AttendanceMethod |  |
| `hours` | Decimal? | optional |
| `overtimeHrs` | Decimal? | optional |
| `wageCost` | Decimal |  |
| `latitude` | Float? | optional |
| `longitude` | Float? | optional |
| `markedById` | String? | optional |
| `createdAt` | DateTime |  |

Indexes: `unique: workerId, date`, `unique: employeeId, date`, `index: companyId, date`, `index: companyId, projectId, date`, `index: employeeId, date`

## Finance

### Invoice

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `number` | String |  |
| `clientId` | String |  |
| `client` | Client → Client |  |
| `projectId` | String? | optional |
| `project` | Project? → Project | optional |
| `quotationId` | String? | optional |
| `quotation` | Quotation? → Quotation | optional |
| `issueDate` | DateTime |  |
| `dueDate` | DateTime? | optional |
| `status` | InvoiceStatus |  |
| `subtotal` | Decimal |  |
| `discount` | Decimal |  |
| `taxAmount` | Decimal |  |
| `total` | Decimal |  |
| `paid` | Decimal |  |
| `paymentTerms` | String? | optional |
| `notes` | String? | optional |
| `createdAt` | DateTime |  |
| `updatedAt` | DateTime |  |
| `deletedAt` | DateTime? | optional |
| `items` | InvoiceItem[] → InvoiceItem (many) |  |
| `payments` | Payment[] → Payment (many) |  |

Indexes: `unique: companyId, number`, `index: companyId, status`, `index: companyId, dueDate`

### InvoiceItem

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `invoiceId` | String |  |
| `invoice` | Invoice → Invoice |  |
| `description` | String |  |
| `unit` | String |  |
| `quantity` | Decimal |  |
| `rate` | Decimal |  |
| `taxPercent` | Decimal |  |
| `amount` | Decimal |  |

### Payment

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `invoiceId` | String |  |
| `invoice` | Invoice → Invoice |  |
| `date` | DateTime |  |
| `amount` | Decimal |  |
| `method` | PaymentMethod |  |
| `reference` | String? | optional |
| `notes` | String? | optional |
| `createdAt` | DateTime |  |

Indexes: `index: companyId, date`

### VendorBill

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `number` | String |  |
| `vendorId` | String |  |
| `vendor` | Vendor → Vendor |  |
| `poId` | String? | optional |
| `po` | PurchaseOrder? → PurchaseOrder | optional |
| `projectId` | String? | optional |
| `billDate` | DateTime |  |
| `dueDate` | DateTime? | optional |
| `amount` | Decimal |  |
| `paid` | Decimal |  |
| `status` | VendorBillStatus |  |
| `notes` | String? | optional |
| `createdAt` | DateTime |  |
| `payments` | VendorPayment[] → VendorPayment (many) |  |

Indexes: `index: companyId, status`, `index: companyId, vendorId`

### VendorPayment

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `vendorId` | String |  |
| `vendor` | Vendor → Vendor |  |
| `billId` | String? | optional |
| `bill` | VendorBill? → VendorBill | optional |
| `date` | DateTime |  |
| `amount` | Decimal |  |
| `method` | PaymentMethod |  |
| `reference` | String? | optional |
| `createdAt` | DateTime |  |

Indexes: `index: companyId, date`

### Expense

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `date` | DateTime |  |
| `category` | ExpenseCategory |  |
| `description` | String |  |
| `amount` | Decimal |  |
| `projectId` | String? | optional |
| `project` | Project? → Project | optional |
| `paidBy` | String? | optional |
| `reference` | String? | optional |
| `approved` | Boolean |  |
| `rejectedAt` | DateTime? | optional |
| `createdById` | String? | optional |
| `createdAt` | DateTime |  |

Indexes: `index: companyId, date`, `index: companyId, projectId`

## Documents

### Document

| Field | Type | Notes |
|---|---|---|
| `id` | String | primary key |
| `companyId` | String |  |
| `name` | String |  |
| `type` | DocumentType |  |
| `folder` | String? | optional |
| `tags` | String? | optional |
| `entityType` | String? | optional |
| `entityId` | String? | optional |
| `storageKey` | String |  |
| `mimeType` | String |  |
| `size` | Int |  |
| `version` | Int |  |
| `expiresAt` | DateTime? | optional |
| `uploadedById` | String? | optional |
| `isPortalVisible` | Boolean |  |
| `createdAt` | DateTime |  |
| `deletedAt` | DateTime? | optional |

Indexes: `index: companyId, entityType, entityId`, `index: companyId, name`

## Enums

- **RoleKey**: OWNER, MANAGEMENT, ADMIN, SALES, PROJECT_MANAGER, DESIGNER, PROCUREMENT, ACCOUNTS, HR, STORE, SITE_ENGINEER, SITE_SUPERVISOR, WORKER, VENDOR, CLIENT
- **LeadStage**: NEW, CONTACTED, QUALIFIED, SITE_VISIT_SCHEDULED, SITE_VISIT_COMPLETED, PROPOSAL_IN_PROGRESS, QUOTATION_SENT, NEGOTIATION, WON, LOST, ON_HOLD
- **Priority**: LOW, MEDIUM, HIGH, URGENT
- **SegmentType**: RESIDENTIAL, COMMERCIAL, RETAIL, CORPORATE, HOTEL
- **QuotationStatus**: DRAFT, PENDING_APPROVAL, APPROVED, SENT, VIEWED, NEGOTIATION, ACCEPTED, REJECTED, EXPIRED
- **BoqStatus**: DRAFT, PENDING_APPROVAL, APPROVED, REVISED
- **BoqCategory**: CIVIL, CARPENTRY, ELECTRICAL, PLUMBING, PAINTING, FALSE_CEILING, FLOORING, FURNITURE, GLASS, HARDWARE, LIGHTING, HVAC, FABRICATION, DECOR, FIXTURES, OTHER
- **ProjectStatus**: PLANNING, DESIGN, QUOTATION, APPROVED, PROCUREMENT, EXECUTION, QUALITY_CHECK, SNAGGING, HANDOVER, COMPLETED, ON_HOLD, CANCELLED
- **TaskStatus**: TODO, IN_PROGRESS, BLOCKED, COMPLETED
- **PurchaseRequestStatus**: DRAFT, PENDING_APPROVAL, APPROVED, REJECTED, ORDERED
- **PoStatus**: DRAFT, PENDING_APPROVAL, APPROVED, SENT_TO_VENDOR, PARTIALLY_RECEIVED, RECEIVED, CLOSED, CANCELLED
- **InventoryTxnType**: INWARD, OUTWARD, TRANSFER, RETURN, ADJUSTMENT, DAMAGED, CONSUMED
- **LocationType**: WAREHOUSE, SITE
- **InvoiceStatus**: DRAFT, PENDING_APPROVAL, SENT, PARTIALLY_PAID, PAID, OVERDUE, CANCELLED
- **PaymentMethod**: CASH, BANK_TRANSFER, UPI, CHEQUE, CARD, OTHER
- **ExpenseCategory**: PROJECT, OFFICE, TRAVEL, PETTY_CASH, MATERIAL, LABOUR, VENDOR, MISC
- **VendorBillStatus**: UNPAID, PARTIALLY_PAID, PAID, CANCELLED
- **AttendanceStatus**: PRESENT, ABSENT, HALF_DAY, LEAVE, OVERTIME
- **AttendanceMethod**: MANUAL, MOBILE, QR, LOCATION
- **LeaveStatus**: PENDING, APPROVED, REJECTED
- **ApprovalType**: QUOTATION, BOQ, PURCHASE_REQUEST, PURCHASE_ORDER, EXPENSE, VENDOR_PAYMENT, CLIENT_DISCOUNT, PROJECT_BUDGET, INVOICE, LEAVE, PAYROLL
- **ApprovalStatus**: PENDING, APPROVED, REJECTED, CANCELLED
- **TicketStatus**: OPEN, ASSIGNED, IN_PROGRESS, WAITING, RESOLVED, CLOSED
- **NotificationType**: FOLLOW_UP, APPROVAL_PENDING, PO_PENDING, MATERIAL_RECEIVED, LOW_STOCK, PAYMENT_DUE, INVOICE_OVERDUE, PROJECT_DEADLINE, TASK_DEADLINE, LEAVE_REQUEST, ATTENDANCE_ISSUE, SUPPORT_TICKET, DOCUMENT_EXPIRY, GENERAL
- **DocumentType**: CONTRACT, DRAWING, FLOOR_PLAN, SITE_PHOTO, INVOICE, BILL, GST, PAN, ID_PROOF, PURCHASE, VENDOR_DOC, PROJECT_REPORT, WARRANTY, OTHER
- **WorkerTrade**: CARPENTER, ELECTRICIAN, PLUMBER, PAINTER, CIVIL, FABRICATOR, HELPER, INSTALLER, FALSE_CEILING, OTHER
- **WageType**: DAILY, MONTHLY, CONTRACT
- **WhatsAppDirection**: INBOUND, OUTBOUND, NOTE
- **EmploymentStatus**: ACTIVE, ON_LEAVE, EXITED
