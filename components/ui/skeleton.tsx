export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`block rounded bg-surface-muted motion-safe:animate-pulse ${className}`} />;
}
