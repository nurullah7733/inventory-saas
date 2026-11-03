import { z } from "zod";
import { money } from "../inventory/fields.ts";
import { MONEY_PATTERN, toCents } from "../numeric.ts";

export const commissionMonth = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/, "Choose a valid month.");
export const commissionFilter = z.object({
  month: commissionMonth,
  userId: z.uuid().transform((value) => value.toLowerCase()).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
}).strict();
export const commissionPolicy = z.object({
  month: commissionMonth,
  userId: z.uuid().transform((value) => value.toLowerCase()),
  enabled: z.boolean(),
  target: money("Monthly target"),
  rate: money("Commission rate").refine((value) => MONEY_PATTERN.test(value) && toCents(value) <= BigInt(10000), "Rate must be between 0 and 100%."),
}).strict();
export const commissionPayment = z.object({
  requestId: z.uuid().transform((value) => value.toLowerCase()),
  month: commissionMonth,
  userId: z.uuid().transform((value) => value.toLowerCase()),
  amount: money("Amount").refine((value) => MONEY_PATTERN.test(value) && toCents(value) > BigInt(0), "Enter a positive payment."),
  note: z.string().trim().max(500).default(""),
}).strict();
