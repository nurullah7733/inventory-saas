import { apiError } from "../api/response.ts";

export { MASTER_DATA_WRITE_ROLES as CUSTOMER_ADMIN_ROLES } from "../inventory/master-data.ts";

export function phoneTaken(owner: { name: string } | null) {
  const message = owner
    ? `This phone number already belongs to "${owner.name}".`
    : "This phone number already belongs to another customer.";
  return apiError("CONFLICT", message, 409, { phone: [message] });
}

export function customerInUse(saleCount: number) {
  const what =
    saleCount > 0
      ? `${saleCount} invoice${saleCount === 1 ? "" : "s"} still reference`
      : "Invoices still reference";
  return apiError(
    "CONFLICT",
    `Cannot delete: ${what} this customer. Mark the customer inactive instead — their invoice history stays intact.`,
    409,
  );
}
