import type { Report, ReportTable } from "./types.ts";

function filename(report: Report, extension: string) {
  return `${report.kind}-${report.from}-${report.to}.${extension}`;
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
export async function exportExcel(report: Report) {
  const { Workbook } = await import("exceljs");
  const book = new Workbook(); book.creator = report.business;
  const summary = book.addWorksheet("Summary");
  summary.addRows([[report.business], [report.title], ["From", report.from, "To", report.to], ["Currency", report.currency],
    ["Generated", report.generatedAt], [], ...report.summary.map((m) => [m.label, m.value]), [], ...report.notes.map((n) => [n])]);
  for (const table of report.tables) {
    const sheet = book.addWorksheet(table.title.slice(0, 31));
    // Strings remain literal cells, including values beginning with =, +, - or @.
    sheet.addRow(table.columns); sheet.addRows(table.rows);
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: table.columns.length } };
  }
  for (const sheet of book.worksheets) {
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach((column) => { column.width = 24; });
    sheet.eachRow((row) => { row.alignment = { vertical: "top", wrapText: true }; });
  }
  const buffer = await book.xlsx.writeBuffer();
  download(new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename(report, "xlsx"));
}

/** Render with the browser's fonts so Bengali and other Unicode names retain their shaping. */
export async function exportPdf(report: Report) {
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import("jspdf"), import("html2canvas")]);
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  pdf.setProperties({ title: report.title, author: report.business });
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:1100px;background:white;color:#18181b;font:16px Arial,sans-serif;padding:30px;box-sizing:border-box;";
  document.body.append(host);
  let pageNumber = 0;
  function text(tag: string, value: string) { const node = document.createElement(tag); node.textContent = value; host.append(node); return node; }
  async function page(table?: ReportTable, rows?: ReportTable["rows"]) {
    host.replaceChildren();
    text("h1", `${report.business} — ${report.title}`);
    text("p", `${report.from} to ${report.to} · ${report.currency} · Generated ${report.generatedAt}`);
    if (!table) {
      for (const metric of report.summary) text("p", `${metric.label}: ${metric.money ? report.currency + " " : ""}${metric.value}`);
      for (const note of report.notes) text("p", note);
    } else {
      text("h2", table.title);
      const node = document.createElement("table"); node.style.cssText = "width:100%;border-collapse:collapse;table-layout:fixed;font-size:14px;";
      for (const [index, values] of [table.columns, ...(rows ?? [])].entries()) {
        const tr = document.createElement("tr");
        for (const value of values) {
          const td = document.createElement(index === 0 ? "th" : "td"); td.textContent = String(value);
          td.style.cssText = "border:1px solid #d4d4d8;padding:8px;text-align:left;overflow-wrap:anywhere;vertical-align:top;";
          tr.append(td);
        }
        node.append(tr);
      }
      host.append(node);
      if (!rows?.length) text("p", "No records in this period.");
    }
    text("p", `Page ${++pageNumber}`);
    await document.fonts.ready;
    const canvas = await html2canvas(host, { scale: 1.5, backgroundColor: "#ffffff", logging: false });
    if (pageNumber > 1) pdf.addPage();
    const scale = Math.min(277 / canvas.width, 190 / canvas.height);
    // JPEG keeps long reports small enough to download/share on shop phones.
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 10, 10, canvas.width * scale, canvas.height * scale);
  }
  try {
    await page();
    for (const table of report.tables) {
      if (!table.rows.length) await page(table, []);
      for (let offset = 0; offset < table.rows.length; offset += 12) await page(table, table.rows.slice(offset, offset + 12));
    }
    pdf.save(filename(report, "pdf"));
  } finally { host.remove(); }
}
