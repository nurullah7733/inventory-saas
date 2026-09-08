import type { Numeric } from "@prisma/orm-postgres/target/codec-types";

export function numeric<P extends number, S extends number>(
  value: string | number,
): Numeric<P, S> {
  return String(value) as unknown as Numeric<P, S>;
}
