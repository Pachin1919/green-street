import { useEffect, useRef, useState } from "react";
import { ArrowCounterClockwise, CheckCircle, Clock, Database, DownloadSimple, FileArrowUp, WarningCircle } from "@phosphor-icons/react";
import { databaseState, dataLabel, dateRange, fetchDataSources, fetchDataStatus, readDataset } from "./dataset";
import type { DataSources, DataStatus, Market } from "./dataset";
export { TalkWalkPage } from "./TalkWalkLearning";
import { download } from "./portfolio";
import { Button } from "./ui";
import styles from "./DataWorkspace.module.css";

export function DataStatusBar({ status, error, market, onMarketChange, onSources }: {
  status: DataStatus | null; error: string; market: Market; onMarketChange: (market: Market) => void; onSources: () => void;
}) {
  const state = databaseState(status, error);
  const Icon = state === "unavailable" ? WarningCircle : state === "current" ? CheckCircle : state === "dated" ? Clock : Database;
  const description = error || (state === "checking" ? "Loading data availability and observation dates" : status?.mode === "demo" ? "Database unavailable · Illustrative values for exploring the workspace" : state === "unavailable" ? "No database coverage for the selected market" : state === "dated" ? `${status?.missing_markets.length ? "Some market coverage is missing · " : ""}Freshness unverified · Coverage periods vary by measure` : "Verified latest database feed · Coverage periods vary by measure");
  return <div className={styles.statusBar} data-state={state}>
    <div role="status" aria-label="Database status"><Icon size={18} weight="fill" /><span><strong>{error ? "Database data unavailable" : state === "checking" ? "Checking database data…" : dataLabel(status)}</strong><small>{description}</small></span></div>
    <label>Listing market<select aria-label="Listing market" value={market} onChange={e => onMarketChange(e.target.value as Market)}><option value="all">All · Hong Kong &amp; Taiwan</option><option value="hk">Hong Kong</option><option value="tw">Taiwan</option></select></label>
    <button type="button" onClick={onSources}>Data sources</button>
  </div>;
}

export function DataSourcesPage({ datasetId, status, onDatasetChange }: { datasetId: string; status: DataStatus | null; onDatasetChange: (id: string) => void }) {
  const [sources, setSources] = useState<DataSources | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [sourceStatus, setSourceStatus] = useState<DataStatus | null>(null);
  const coverageStatus = sourceStatus ?? status;
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true; setSources(null); setSourceStatus(null); setError("");
    Promise.all([fetchDataSources(), fetchDataStatus("all")]).then(([data, coverage]) => { if (active) { setSources(data); setSourceStatus(coverage); } }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [datasetId]);
  async function schema() {
    try { const data = await readDataset<unknown>("/api/data/schema"); download("green-street-dataset-schema.json", JSON.stringify(data, null, 2), "application/json"); }
    catch (err) { setError((err as Error).message); }
  }
  async function mount(file?: File) {
    if (!file) return;
    setError(""); setBusy(true);
    try {
      if (!file.name.toLowerCase().endsWith(".json")) throw new Error("Choose a standard JSON dataset file.");
      if (file.size > 32 * 1024 * 1024) throw new Error("The dataset must be smaller than 32 MiB.");
      let payload: unknown;
      try { payload = JSON.parse(await file.text()); } catch { throw new Error("This file is not valid JSON. Download the schema to check the required format."); }
      const mounted = await readDataset<{ dataset_id: string }>("/api/data/mount", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      onDatasetChange(mounted.dataset_id);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  return <div className={`workspace-page ${styles.page}`}>
    <div className="workspace-heading"><div><span className="workspace-eyebrow">DATA WORKSPACE</span><h1>Data sources</h1><p>Review the active dataset and bring in a dated dataset.</p></div></div>
    <section className="workspace-panel">
      <div className="panel-heading"><div><h2>Active dataset</h2><p>{datasetId === "builtin" ? "Built-in dataset" : "Mounted JSON dataset"} · {dataLabel(coverageStatus)}</p></div><Database size={24} /></div>
      <div className={styles.coverage}>{(["hk", "tw"] as const).map(market => {
        const coverage = coverageStatus?.markets[market];
        return <article key={market}><strong>{market === "hk" ? "Hong Kong" : "Taiwan"}</strong><span>{coverage?.company_count ?? 0} companies · {coverage?.status === "missing" || !coverage ? "Insufficient data" : "Database coverage"}</span><small>{dateRange(coverage?.status === "missing" ? undefined : coverage?.data_dates)}</small></article>;
      })}</div>
      {coverageStatus?.limitations?.length ? <ul className={styles.limitations}>{coverageStatus.limitations.map(text => <li key={text}>{text}</li>)}</ul> : null}
      <p className={styles.note}>The listing-market selector limits companies and recommendation candidates. Domicile and the financial model’s market proxy are separate attributes.</p>
      {datasetId !== "builtin" && <Button kind="secondary" onClick={() => onDatasetChange("builtin")}><ArrowCounterClockwise size={18} />Use built-in dataset</Button>}
    </section>
    <section className="workspace-panel">
      <div className="panel-heading"><div><h2>Import a JSON dataset</h2><p>Use metadata and supported tables from the standard schema. Validation happens before activation.</p></div></div>
      <div className={styles.sourceActions}><Button onClick={() => input.current?.click()} disabled={busy}><FileArrowUp size={18} />{busy ? "Validating dataset…" : "Upload JSON dataset"}</Button><Button kind="secondary" onClick={() => void schema()}><DownloadSimple size={18} />Download schema</Button></div>
      <input ref={input} className="sr-only" type="file" aria-label="JSON dataset" accept=".json,application/json" onChange={e => void mount(e.target.files?.[0])} />
      <p className={styles.note}>The active selection is saved in this browser. Existing holdings stay in your portfolio; holdings outside the new universe can remain frozen. Mounted datasets are stored by this backend and may need to be uploaded again after a restart.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
    <section className="workspace-panel">
      <div className="panel-heading"><div><h2>Source coverage</h2><p>Rows and dates reflect the active dataset’s available tables.</p></div></div>
      {sources ? <div className="table-scroll"><table className="analysis-table"><thead><tr><th>Table / source</th><th>Market</th><th>Measure</th><th>Rows</th><th>Date range</th><th>Availability</th></tr></thead><tbody>{sources.sources.map(source => <tr key={source.key}><td><strong>{source.key}</strong><small className={styles.sourcePath}>{source.source}</small></td><td>{source.market === "hk" ? "Hong Kong" : source.market === "tw" ? "Taiwan" : source.market}</td><td>{source.kind}</td><td>{source.rows.toLocaleString()}</td><td>{dateRange(source.data_dates)}</td><td>{source.available ? "Available" : "Insufficient data"}</td></tr>)}</tbody></table></div> : <p className={styles.note}>{error ? "Source coverage is unavailable. Use the built-in dataset or retry the upload." : "Loading source coverage…"}</p>}
    </section>
    <section className="workspace-panel"><div className="panel-heading"><div><h2>Supported data routes</h2><p>Choose an import format that the adapter supports.</p></div></div><div className={styles.routes}><article><strong>Internal CSV / Parquet</strong><p>The backend reads configured local source tables. These are internal readers; this screen does not upload arbitrary CSV or Parquet tables.</p></article><article><strong>External SQL / API</strong><p>Export your source to the standard JSON dataset, then upload it above. Native database and API connections are not implemented.</p></article></div></section>
  </div>;
}
