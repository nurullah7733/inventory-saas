import Image from "next/image";

/** Platform branding; shop logos are rendered separately by TenantLogo. */
export function PlatformLogo({ compact = false }: { compact?: boolean }) {
  return compact ? (
    <Image src="/icon.png" width={40} height={40} alt="STOCK" className="h-10 w-10 shrink-0 object-contain" />
  ) : (
    <span className="inline-flex w-48 max-w-full shrink-0 rounded-lg bg-white p-small">
      <Image src="/stock-logo.png" width={955} height={290} alt="STOCK - Inventory Solutions" className="h-auto w-full object-contain" />
    </span>
  );
}
