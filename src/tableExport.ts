// The three tables of the recommendation page, exportable as PDF, CSV or JSON.
// CSV and JSON carry raw numbers (weights and returns as fractions); the PDF shows them
// formatted as on screen.
import type { Recommendation } from "./api";
import { comparisonChange, comparisonPositions, performanceRows } from "./Comparison";
import { tradeAction } from "./live";
import type { Universe } from "./live";
import { money, percent, score, unitMoney } from "./portfolio";
import type { Portfolio } from "./portfolio";

type Cell = string | number | null | undefined;
export type TableFormat = "pdf" | "csv" | "json";
export type ExportTable = { title: string; detail: string; file: string; columns: { key: string; label: string }[]; raw: Cell[][]; text: string[][] };
export const TABLE_FORMATS: { value: TableFormat; label: string }[] = [
  { value: "pdf", label: "PDF · Formatted table" },
  { value: "csv", label: "CSV · Spreadsheet" },
  { value: "json", label: "JSON · Structured data" },
];

// Drops floating-point noise (28000.000000000004) without changing any figure that is shown.
const round = (x: number | null | undefined, digits = 6) => (x == null ? null : Number(x.toFixed(digits)));
const shown = (x: number | null | undefined, fmt: (x: number) => string) => (x == null ? "Unavailable" : fmt(x));
const signed = (x: number | null | undefined) => (x == null ? "Unavailable" : `${x > 0 ? "+" : ""}${x}`);

export function exportTables(baseline: Portfolio, result: Portfolio, rec: Recommendation, universe: Universe): ExportTable[] {
  const ccy = baseline.baseCurrency;
  const positions = comparisonPositions(rec).map(t => ({ t, c: universe.get(t.firm_id), action: tradeAction(t.side, t.w_current, t.w_target).label, oldWeight: t.capital_current / rec.total_capital }));
  const recommended = [...positions].sort((a, b) => b.t.w_target - a.t.w_target);
  let section = "";
  const performance = performanceRows(baseline, result, rec.before, rec.after, rec.target_capital).map(r => ({ r, section: (section = r.section ?? section), delta: r.before === null || r.after === null ? null : r.after - r.before }));
  return [
    { title: "Recommended positions", detail: "What to hold after the trades: action, shares, value and weight.", file: "recommended-positions",
      columns: [["ticker", "Ticker"], ["company", "Company"], ["sector", "Sector"], [`unit_price_${ccy}`, "Unit price"], ["action", "Action"], ["shares", "Shares"], ["shares_change", "Change"], [`total_${ccy}`, "Total"], ["weight", "Weight"], ["e_score", "E-score"]].map(([key, label]) => ({ key, label })),
      raw: recommended.map(({ t, c, action }) => [t.firm_id, c?.name ?? t.firm_id, c?.sector, round(t.price, 3), action, t.shares_target, t.shares_delta, round(t.capital_target, 2), round(t.w_target), c?.score]),
      text: recommended.map(({ t, c, action }) => [t.firm_id, c?.name ?? t.firm_id, c?.sector ?? "", shown(t.price, x => unitMoney(x, ccy)), action, shown(t.shares_target, String), signed(t.shares_delta), money(t.capital_target, ccy), percent(t.w_target, 1), score(c?.score ?? null)]) },
    { title: "Portfolio performance", detail: "Old vs new key figures: risk, return, environment, concentration, factor exposures.", file: "portfolio-performance",
      columns: [["section", "Section"], ["metric", "Metric"], ["old_portfolio", "Old portfolio"], ["new_portfolio", "New portfolio"], ["change", "Change"]].map(([key, label]) => ({ key, label })),
      raw: performance.map(({ r, section, delta }) => [section, r.label, round(r.before), round(r.after), round(delta)]),
      text: performance.map(({ r, section }) => [section, r.label, shown(r.before, r.fmt), shown(r.after, r.fmt), comparisonChange(r.before, r.after, r.changeFmt ?? r.fmt).text]) },
    { title: "Each company / share", detail: "Every position with old and new units, totals and weights.", file: "company-shares",
      columns: [["ticker", "Ticker"], ["company", "Company"], ["sector", "Sector"], [`unit_price_${ccy}`, "Unit price"], ["old_units", "Old units"], ["new_units", "New units"], ["units_change", "Change"], [`old_total_${ccy}`, "Old total"], [`new_total_${ccy}`, "New total"], ["e_score", "E-score"], ["old_weight", "Old weight"], ["new_weight", "New weight"], ["action", "Action"]].map(([key, label]) => ({ key, label })),
      raw: positions.map(({ t, c, action, oldWeight }) => [t.firm_id, c?.name ?? t.firm_id, c?.sector, round(t.price, 3), t.shares_current, t.shares_target, t.shares_delta, round(t.capital_current, 2), round(t.capital_target, 2), c?.score, round(oldWeight), round(t.w_target), action]),
      text: positions.map(({ t, c, action, oldWeight }) => [t.firm_id, c?.name ?? t.firm_id, c?.sector ?? "", shown(t.price, x => unitMoney(x, ccy)), shown(t.shares_current, String), shown(t.shares_target, String), signed(t.shares_delta), money(t.capital_current, ccy), money(t.capital_target, ccy), score(c?.score ?? null), percent(oldWeight, 1), percent(t.w_target, 1), action]) },
  ];
}

const quote = (v: Cell) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/** One table in one format, ready for `download`. `context` is the line under the PDF title. */
export async function renderTable(table: ExportTable, format: TableFormat, context: string) {
  const name = `green-street-${table.file}.${format}`;
  if (format === "csv") // the BOM makes Excel read the file as UTF-8 (labels contain "·")
    return { name, mimeType: "text/csv;charset=utf-8", content: "﻿" + [table.columns.map(c => c.key), ...table.raw].map(r => r.map(quote).join(",")).join("\r\n") + "\r\n" };
  if (format === "json")
    return { name, mimeType: "application/json", content: JSON.stringify({ table: table.title, context, rows: table.raw.map(r => Object.fromEntries(table.columns.map((c, i) => [c.key, r[i] ?? null]))) }, null, 2) };
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const width = doc.internal.pageSize.getWidth(), height = doc.internal.pageSize.getHeight(), margin = 14;
  const ascii = (s: string) => s.replace(/[·–—]/g, "-").replace(/−/g, "-"); // the built-in PDF font has no "·" or "−"
  const header = () => {
    doc.setFillColor(20, 60, 49); doc.rect(0, 0, width, 26, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.text("Green Street", margin, 12);
    doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.text(ascii(table.title), width - margin, 12, { align: "right" });
    doc.setTextColor(197, 220, 207); doc.setFontSize(8.5); doc.text(ascii(context), margin, 20);
  };
  autoTable(doc, { head: [table.columns.map(c => c.label)], body: table.text.map(r => r.map(ascii)), margin: { left: margin, right: margin, top: 34, bottom: 16 },
    theme: "striped", styles: { font: "helvetica", fontSize: 8, cellPadding: 2.6, textColor: [53, 73, 64], overflow: "linebreak" },
    headStyles: { fillColor: [42, 91, 71], textColor: [255, 255, 255], fontStyle: "bold" }, alternateRowStyles: { fillColor: [245, 249, 246] },
    didDrawPage: header });
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(102, 124, 112);
    doc.text("Green Street | Portfolio analysis", margin, height - 7); doc.text(`Page ${page} of ${pages}`, width - margin, height - 7, { align: "right" });
  }
  doc.setProperties({ title: `Green Street | ${table.title}`, author: "Green Street" });
  return { name, mimeType: "application/pdf", content: doc.output("arraybuffer") };
}
