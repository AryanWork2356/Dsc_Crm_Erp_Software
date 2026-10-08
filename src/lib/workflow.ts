import "server-only";
// Importing handlers here guarantees they're registered wherever approvals are used.
import "./approval-handlers";
export { requestApproval, decide, canDecide, requiredRoleFor } from "./approvals";
