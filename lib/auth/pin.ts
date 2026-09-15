import { rlsDb } from "../db/rls.ts";

const MAX_ATTEMPTS_BEFORE_LOCK = 5;

const BASE_LOCK_SECONDS = 60;
const MAX_LOCK_SECONDS = 60 * 60;

export interface PinGateState {
  pinHash: string | null;
  pinFailedAttempts: number;
  pinLockedUntil: string | null;
}

export type PinGate =
  | { status: "ok" }
  | { status: "not_set" }
  | { status: "locked"; retryAfterSeconds: number };

export function checkPinGate(state: PinGateState): PinGate {
  if (!state.pinHash) return { status: "not_set" };

  if (state.pinLockedUntil) {
    const remainingMs = Date.parse(state.pinLockedUntil) - Date.now();
    if (remainingMs > 0) {
      return {
        status: "locked",
        retryAfterSeconds: Math.ceil(remainingMs / 1000),
      };
    }
  }
  return { status: "ok" };
}

function lockSecondsFor(attempts: number): number {
  const overage = attempts - MAX_ATTEMPTS_BEFORE_LOCK;
  if (overage < 0) return 0;
  return Math.min(BASE_LOCK_SECONDS * 2 ** overage, MAX_LOCK_SECONDS);
}

export interface PinFailureOutcome {
  attempts: number;
  lockedForSeconds: number;
}

/** Record a wrong PIN and apply the backoff. */
export async function recordPinFailure(
  userId: string,
  currentAttempts: number,
): Promise<PinFailureOutcome> {
  const attempts = currentAttempts + 1;
  const lockedForSeconds = lockSecondsFor(attempts);
  const lockedUntil =
    lockedForSeconds > 0
      ? new Date(Date.now() + lockedForSeconds * 1000).toISOString()
      : null;

  await rlsDb().orm.public.User.where({ id: userId }).update({
    pinFailedAttempts: attempts,
    pinLockedUntil: lockedUntil,
  });

  return { attempts, lockedForSeconds };
}

/** Clear the counter after a correct PIN, so an unlucky run of typos does not
 *  accumulate against a legitimate user forever. */
export async function clearPinFailures(userId: string): Promise<void> {
  await rlsDb().orm.public.User.where({ id: userId }).update({
    pinFailedAttempts: 0,
    pinLockedUntil: null,
  });
}
