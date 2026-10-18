"use client";

import { queryOptions } from "@tanstack/react-query";
import { apiRequest } from "./api.ts";
import type { ProductListResponse } from "../inventory/products.ts";
import type { CustomerResponse } from "../people/customers.ts";
import type { StockMovementListResponse } from "../inventory/stock.ts";
import type { InvoiceList } from "../sales/types.ts";

type Status = "active" | "inactive" | "all";
export function productsListOptions(filters = { term: "", categoryId: "", status: "active" as Status | "deleted", page: 1 }) {
  const { term, categoryId, status, page } = filters;
  const params = new URLSearchParams({ status, page: String(page), pageSize: "20" });
  if (term) params.set("search", term);
  if (categoryId) params.set("categoryId", categoryId);
  return queryOptions({ queryKey: ["inventory", "products", "list", filters], queryFn: ({ signal }) => apiRequest<ProductListResponse>(`/products?${params}`, { signal }) });
}
export function customersListOptions(filters = { term: "", filter: "active" as Status, page: 1 }) {
  const { term, filter, page } = filters;
  const params = new URLSearchParams({ status: filter, page: String(page), pageSize: "20" });
  if (term) params.set("search", term);
  return queryOptions({ queryKey: ["people", "customers", "list", filters], queryFn: ({ signal }) => apiRequest<{ customers: CustomerResponse[]; page: number; pageSize: number; total: number }>(`/customers?${params}`, { signal }) });
}
export function stockListOptions(filters = { type: "in" as const, supplierId: "", page: 1 }) {
  const { supplierId, page } = filters;
  const params = new URLSearchParams({ type: "in", page: String(page), pageSize: "20" });
  if (supplierId) params.set("supplierId", supplierId);
  return queryOptions({ queryKey: ["inventory", "stock-movements", filters], queryFn: ({ signal }) => apiRequest<StockMovementListResponse>(`/stock-movements?${params}`, { signal }) });
}
export function invoicesListOptions(params: URLSearchParams) {
  return queryOptions({ queryKey: ["sales", "invoices", params.toString()], queryFn: ({ signal }) => apiRequest<InvoiceList>(`/invoices?${params}`, { signal }) });
}
