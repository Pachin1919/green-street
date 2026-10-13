import { useEffect, useRef, useState } from "react";
import { ArrowRight, DownloadSimple, FileArrowUp } from "@phosphor-icons/react";
import { displayTicker, download, importTemplate, money, normalizeImport, parsePortfolioImport, unitMoney } from "./portfolio";
import type { Lookup, ParsedImport, Portfolio } from "./portfolio";
import { exchangeRate } from "./marketData";
import { fetchFx } from "./dataset";
import type { FxRate } from "./dataset";
import { Button } from "./ui";
import PortfolioImportHelp from "./PortfolioImportHelp";

export default function ImportFlow({ lookup, onImport }: { lookup: Lookup; onImport: (p: Portfolio) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedImport | null>(null), [fileName, setFileName] = useState("");
  const base = "HKD";
  const [rates, setRates] = useState<FxRate[]>([]), [fxLoading, setFxLoading] = useState(true), [fxError, setFxError] = useState("");
  const [error, setError] = useState(""), [reading, setReading] = useState(false);
  const currencies = [...new Set(parsed?.holdings.map(h => h.currency) ?? [])];
  const foreign = currencies.filter(c => c !== base);
  let preview: Portfolio | null = null, conversionError = "";
  useEffect(() => {
    let active = true;
    fetchFx().then(data => { if (active) setRates(data.rates); }).catch(err => { if (active) setFxError(err.message); }).finally(() => { if (active) setFxLoading(false); });
    return () => { active = false; };
  }, []);
  if (parsed) { try { preview = normalizeImport(parsed, base, fileName, rates); } catch (e) { conversionError = (e as Error).message; } }
  async function read(file?: File) {
    if (!file) return;
    setParsed(null); setError(""); setReading(true);
    try {
      if (!file.name.toLowerCase().endsWith(".csv")) throw new Error("Choose a CSV file.");
      if (file.size > 10 * 1024 * 1024) throw new Error("The file must be smaller than 10 MB.");
      const data = parsePortfolioImport(await file.text(), lookup); setParsed(data); setFileName(file.name);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not read this file."); }
    finally { setReading(false); if (input.current) input.current.value = ""; }
  }
  return <div className="setup-body import-body"><span className="setup-icon"><FileArrowUp /></span><h3>Import your current holdings.</h3><p>Use current market value, not original purchase cost. Reporting and optimization use HKD. Foreign values require an available dated FX pair in the selected dataset.</p>
    <input ref={input} type="file" accept=".csv,text/csv" aria-label="Portfolio CSV" className="sr-only" onChange={e => { void read(e.target.files?.[0]); }} />
    <Button kind="secondary" onClick={() => input.current?.click()} disabled={reading}><FileArrowUp />{reading ? "Reading CSV…" : parsed ? "Choose another CSV" : "Choose a CSV file"}</Button>
    <div className="import-format"><span>Required: ticker (e.g. 0700.HK), current value, currency · Optional: units, unit_price</span><button onClick={() => download("green-street-portfolio-template.csv", importTemplate)}><DownloadSimple size={16} />Download CSV template</button></div>
    <PortfolioImportHelp />
    {error && <p className="form-error" role="alert">{error}</p>}
    {parsed && <div className="import-review"><strong>{fileName} · {parsed.holdings.length} holdings</strong><p>Valuation date: {parsed.asOf}. {parsed.sourceCurrency ? `Market values are already expressed in ${parsed.sourceCurrency}; the stock-currency field is not applied again.` : "Values use the currency declared on each row."}</p><p><strong>Reporting currency: HKD</strong> · Capital amounts remain in HKD; model risk and excess return use USD.</p>
      {foreign.length > 0 && <div className="automatic-fx"><strong>Dated database FX conversion</strong><p>Review each rate and date before confirming. Rates use dated observations from the selected database.</p>{foreign.map(c => { let rate: number | null = null; try { rate=exchangeRate(c,base,rates); } catch { /* The missing-rate error is shown below. */ } const evidence=rates.find(item => item.pair===`${c}HKD`); return <div key={c}><span>1 {c}<small>{evidence ? `${evidence.date} · ${evidence.source}` : fxLoading ? "Loading FX…" : "Insufficient data"}</small></span><b>{rate===null?"Unavailable":rate.toFixed(6)} {base}</b></div>; })}</div>}
      {foreign.length > 0 && fxLoading ? <p role="status">Loading dated exchange rates…</p> : conversionError && <p className="form-error" role="alert">{conversionError}{fxError ? ` ${fxError}` : ""}</p>}
      <div className="import-preview table-scroll"><table><thead><tr><th>Asset</th><th>Unit price ({base})</th><th>Units</th><th>Total value ({base})</th></tr></thead><tbody>{(preview?.holdings ?? parsed.holdings).map(h => <tr key={h.id}><td>{h.name}<small>{displayTicker(h.ticker)}</small></td><td>{h.unitPrice==null?"Unavailable":unitMoney(h.unitPrice,h.currency)}</td><td>{h.units??"Unavailable"}</td><td>{money(h.value,h.currency)}</td></tr>)}</tbody></table></div>
      <Button onClick={() => { if(preview) onImport(preview); }} disabled={!preview || (foreign.length > 0 && fxLoading)}>Confirm upload <ArrowRight /></Button>
    </div>}
    <p className="privacy-note">Your holdings and settings are saved in this browser.</p>
  </div>;
}
