import { AppShell } from "@/components/shell/app-shell.tsx";

/** Shared chrome renders immediately; authenticated data loads in client hooks. */
export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
