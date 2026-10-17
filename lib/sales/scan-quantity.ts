/** Add one unit, or the remaining measured stock when below one unit. */
export function nextScanQuantity(current: number, stock: number): number {
  if (!Number.isFinite(current) || current < 0 || Number(current.toFixed(3)) !== current) {
    throw new Error("Correct this item's quantity before adding more.");
  }
  const held = Math.round(current * 1000);
  const available = Math.round(stock * 1000);
  if (!Number.isFinite(stock) || available <= held) throw new Error("No more stock is available for this variant.");
  return (held + Math.min(1000, available - held)) / 1000;
}
