import JsBarcode from "jsbarcode";
import { labelCode, labelCopies, MAX_LABELS } from "./label-codes.ts";
import { isArticleNumber } from "./article-numbers.ts";

export interface LabelItem {
  variantId: string;
  productName: string;
  sku: string;
  options: string;
  sellPrice: string;
  copies: string;
  articleNumber?: string;
}

export function labelTotal(items: LabelItem[]): number {
  let total = 0;
  for (const item of items) {
    const count = labelCopies(item.copies);
    if (count === null) throw new Error(`Enter a whole label count between 0 and ${MAX_LABELS}.`);
    total += count;
  }
  if (total > MAX_LABELS) throw new Error(`Print at most ${MAX_LABELS} labels per batch. Reduce copies to print in smaller batches.`);
  return total;
}

/** Delegate encoding/checksum to JsBarcode; keep the SVG geometry identical
 * in the preview and isolated print document. Quiet zones are included. */
export function barcodeGeometry(code: string) {
  const encoded: { encodings?: { data: string }[] } = {};
  // CODE128 supports short numbers of either odd or even length without
  // silently padding the scanned value. Keep legacy UUID geometry supported.
  JsBarcode(encoded, isArticleNumber(code) ? code : labelCode(code), { format: "CODE128", displayValue: false });
  const data = encoded.encodings?.map((encoding) => encoding.data).join("");
  if (!data || !/^[01]+$/.test(data)) throw new Error("Could not encode this barcode.");
  const bars: { x: number; width: number }[] = [];
  for (let i = 0; i < data.length;) {
    if (data[i] === "0") { i++; continue; }
    const start = i;
    while (data[i] === "1") i++;
    bars.push({ x: start + 10, width: i - start });
  }
  return { width: data.length + 20, bars };
}

export type LabelPaper = "roll70" | "roll100" | "a4";

export async function printBarcodeLabels(items: LabelItem[], currency: string, paper: LabelPaper): Promise<void> {
  if (labelTotal(items) === 0) throw new Error("Choose at least one label to print.");
  if (items.some((item) => !item.articleNumber || !isArticleNumber(item.articleNumber) || item.copies !== "1")) {
    throw new Error("Prepare a separate article number for each label before printing.");
  }
  document.querySelector("iframe[data-barcode-print]")?.remove();
  const frame = document.createElement("iframe");
  frame.dataset.barcodePrint = "true";
  frame.title = "Barcode label print document";
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, { position: "fixed", width: "0", height: "0", border: "0" });
  document.body.append(frame);
  try {
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) throw new Error("Your browser could not open the print document.");
    const width = paper === "roll100" ? 100 : 70;
    const height = paper === "roll100" ? 50 : 40;
    const style = doc.createElement("style");
    style.textContent = `@page { size: ${paper === "a4" ? "A4" : `${width}mm ${height}mm`}; margin: ${paper === "a4" ? "10mm" : "0"}; }
      * { box-sizing: border-box; } body { margin:0; color:#000; background:#fff; font-family:Arial,sans-serif; }
      main { ${paper === "a4" ? "display:grid;grid-template-columns:70mm 70mm;gap:3mm;align-content:start;" : "display:block;"} }
      article { width:${width}mm;height:${height}mm;padding:2mm;overflow:hidden;break-inside:avoid;${paper !== "a4" ? "break-after:page;" : ""} }
      article:last-child { break-after:auto; } p { margin:0;overflow-wrap:anywhere; }
      .name { font-size:9pt;font-weight:bold;line-height:1.15;height:6mm;overflow:hidden; }
      .options { font-size:7pt;height:3mm;overflow:hidden; } .price { font-size:11pt;font-weight:bold;height:5mm; }
      svg { display:block;width:100%;height:13mm; } .article { font-size:9pt;font-weight:bold;height:4mm;text-align:center; }
      .sku { font-size:7pt;line-height:1.1;overflow-wrap:anywhere; }
      @media screen { article { outline:1px solid #ddd; } }`;
    doc.head.append(style);
    doc.title = "Product barcode labels";
    const main = doc.createElement("main");
    for (const item of items) {
      const count = labelCopies(item.copies)!;
      if (!count) continue;
      const geometry = barcodeGeometry(item.articleNumber!);
      const label = doc.createElement("article");
      for (const [className, value] of [["name", item.productName], ["options", item.options], ["price", `${currency} ${item.sellPrice}`]]) {
        const p = doc.createElement("p"); p.className = className; p.textContent = value; label.append(p);
      }
      const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", `0 0 ${geometry.width} 50`);
      svg.setAttribute("preserveAspectRatio", "none");
      svg.setAttribute("shape-rendering", "crispEdges");
      for (const bar of geometry.bars) {
        const rect = doc.createElementNS(svg.namespaceURI, "rect");
        rect.setAttribute("x", String(bar.x)); rect.setAttribute("width", String(bar.width)); rect.setAttribute("height", "50");
        svg.append(rect);
      }
      label.append(svg);
      const article = doc.createElement("p"); article.className = "article"; article.textContent = item.articleNumber!; label.append(article);
      const sku = doc.createElement("p"); sku.className = "sku"; sku.textContent = item.sku; label.append(sku);
      for (let i = 0; i < count; i++) main.append(label.cloneNode(true));
    }
    doc.body.append(main);
    await doc.fonts.ready;
    await new Promise<void>((resolve) => win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve())));
    win.addEventListener("afterprint", () => frame.remove(), { once: true });
    win.focus(); win.print();
  } catch (error) { frame.remove(); throw error; }
}
