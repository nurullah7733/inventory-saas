import { rawSql, rlsDb, type RlsSession } from "../db/rls.ts";

const checks = new WeakMap<RlsSession, Promise<boolean>>();

/** Recheck on each transaction so a completed migration takes effect immediately. */
export function supportsDiscountPercentage(): Promise<boolean> {
  const session = rlsDb();
  let check = checks.get(session);
  if (!check) {
    check = Promise.resolve(session.query(rawSql`SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sales' AND column_name = 'discount_percentage'
    ) AS present`.returnsRow({ present: "pg/bool@1" }).build()))
      .then((rows) => rows[0]?.present === true);
    checks.set(session, check);
  }
  return check;
}
