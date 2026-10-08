import { AsyncLocalStorage } from "node:async_hooks";
import type { AuthUser } from "../auth/context.ts";

const actors = new AsyncLocalStorage<AuthUser>();
export const currentAuditActor = () => actors.getStore();
export function withAuditActor<T>(user: AuthUser, run: () => T): T { return actors.run(user, run); }
