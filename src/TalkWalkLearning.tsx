import { useEffect, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { dataLabel, fetchTalkWalk } from "./dataset";
import type { DataStatus, EnvironmentalFirm, Market, TalkWalkData, TalkWalkFirm } from "./dataset";
import type { Universe } from "./live";
import { Button } from "./ui";
import styles from "./DataWorkspace.module.css";

const missing = "Not provided in this dataset";
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const value = (n: unknown, digits = 2) => finite(n) ? (n === 0 ? 0 : n).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }) : missing;
const signed = (n: unknown) => finite(n) ? `${n > 0 ? "+" : ""}${value(n)}` : missing;
const friendly = (key: string) => key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
function evidenceText(item: unknown): string {
  if (item == null || item === "") return missing;
  if (typeof item === "object") return Object.entries(item as Record<string, unknown>).map(([k, v]) => `${friendly(k)}: ${evidenceText(v)}`).join(" · ");
  return String(item);
}
function yearsOf(rows: { year?: number }[]) { return rows.flatMap(row => finite(row.year) ? [row.year] : []).sort((a, b) => b - a); }
// A chosen year must have exactly one record; neither older years nor duplicate rows are substitutes.
function forYear<T extends { year?: number }>(rows: T[], year: string): T | undefined {
  const matched = rows.filter(row => String(row.year) === year);
  return matched.length === 1 ? matched[0] : undefined;
}
function signal(row?: TalkWalkFirm) {
  if (!row || !finite(row.talk) || !finite(row.walk) || !finite(row.gap) || row.assessment_status === "insufficient_data") return "Insufficient data · Assessment unavailable";
  if (row.greenwasher === true) return "Greenwash signal detected";
  if (row.greenhusher === true) return "Quiet-action signal detected";
  if (row.greenwasher == null || row.greenhusher == null) return "Insufficient data · Classification not provided";
  return "No signal detected";
}
function YearSelect({ label, years, selected, onChange }: { label: string; years: number[]; selected: string; onChange: (year: string) => void }) {
  return <label className={styles.yearControl}>{label}<select aria-label={label} value={selected} disabled={!years.length} onChange={e => onChange(e.target.value)}>{!years.length && <option value="">Year unavailable</option>}{years.map(y => <option key={y} value={y}>{y}</option>)}</select></label>;
}
function Formula({ children, symbols }: { children: React.ReactNode; symbols: string }) {
  return <><div className={styles.formula}>{children}</div><p className={styles.symbols}>{symbols}</p></>;
}
function CalculationSteps({ row, year }: { row?: EnvironmentalFirm; year: string }) {
  const confirmed = row?.default_hard_path === true && row.walk_matches_e_score === true;
  return <div className={styles.calculationSteps}>
    <p className={styles.flow} aria-label="Environmental calculation flow">Emissions & revenue <span>→</span> Intensity <span>→</span> E-score <span>→</span> Industry E_weight <span>→</span> g</p>
    <p className={styles.note}>{confirmed ? "Hard-data Walk = current E-score · The default intensity pathway is documented for this record." : "Default method reference · This record does not document the scoring pathway; Walk = E-score is not assumed."}</p>
    <details><summary>01 · Emissions & revenue</summary><div className={styles.stepBody}>
      <p>Scope 1 covers direct emissions from company operations. Scope 2 covers indirect emissions from purchased electricity, heat and other energy. Revenue adjusts for company size.</p>
      <dl className={styles.inputFacts}><div><dt>Scope 1 · tCO₂e</dt><dd>{value(row?.scope1)}</dd></div><div><dt>Scope 2 · tCO₂e</dt><dd>{value(row?.scope2)}</dd></div><div><dt>Revenue · USD million</dt><dd>{value(row?.revenue)}</dd></div></dl>
      <p>Input source: {row?.input_source || missing}. Score table: {row?.source || missing}.</p>
      <p>Only saved inputs for this company and year are shown. Dates, currencies and units must align; missing values are not zero.</p>
    </div></details>
    <details><summary>02 · Emission intensity</summary><div className={styles.stepBody}>
      <Formula symbols="Numerator: Scope 1 + Scope 2 in tCO₂e. Denominator: revenue in USD million. Result: tCO₂e per USD million.">Emission intensity = (Scope 1 + Scope 2) ÷ Revenue</Formula>
      <p>Saved intensity: <strong>{value(row?.intensity)}</strong>. Lower is better in the default method. This page does not reconstruct the inputs.</p>
      <p>The default scoring script fills missing components with zero when adding Scope 1 and Scope 2. This view preserves the original missing values so absent disclosures are not presented as zero emissions.</p>
    </div></details>
    <details><summary>03 · E-score</summary><div className={styles.stepBody}>
      <Formula symbols="r: intensity rank from lowest to highest, with average ranks for ties. n: companies with valid intensity in the comparison group, rather than all listed companies.">E-score = 10 × [1 − (r − 1) ÷ (n − 1)]</Formula>
      <dl className={styles.inputFacts}><div><dt>Sector</dt><dd>{row?.sector || missing}</dd></div><div><dt>Year</dt><dd>{year || missing}</dd></div><div><dt>Actual comparison group</dt><dd>{row?.rank_group === "_all" ? "_all · Pooled small sectors" : row?.rank_group || missing}</dd></div><div><dt>Rank r</dt><dd>{value(row?.rank)}</dd></div><div><dt>Group size n</dt><dd>{value(row?.comparison_count, 0)}</dd></div></dl>
      <p>Default implementation: sectors with at least 5 companies in a year are ranked within that sector. Smaller sectors are pooled into that year's _all group; larger sectors do not join it. The actual group is shown only when provided.</p>
      <p>A group with one valid value receives a score of 5. Missing intensity remains missing. A score of 7.8 is a relative rank, not "78% environmentally friendly".</p>
    </div></details>
    <details><summary>04 · E_weight</summary><div className={styles.stepBody}>
      <Formula symbols="Sum emissions and revenue separately across the eligible industry records to obtain aggregate industry intensity.">Industry intensity = Total industry emissions ÷ Total industry revenue</Formula>
      <Formula symbols="p: industry's intensity percentile among industries in the same year, using average ranks. Default range: 5–50; the actual minimum depends on the number of industries.">E_weight = 5 + 45 × p</Formula>
      <p>Saved E_weight: <strong>{value(row?.e_weight)}</strong>. Higher industry intensity increases the weight of the performance shortfall in g. This is not portfolio allocation.</p>
      <p>Industry totals and percentiles are not provided as page inputs and are not inferred from company weights. The default method uses carbon intensity as a proxy for industry environmental importance.</p>
      <p>The calculation includes records with both Walk and sector information. It recovers revenue from saved emission level ÷ intensity, then fills unavailable revenue, including zero-intensity cases, with the industry-year median before aggregation. These intermediate inputs are not all saved; reported revenue for every company cannot be assumed to be the weight calculation's input.</p>
    </div></details>
    <details><summary>05 · Company g</summary><div className={styles.stepBody}>
      <Formula symbols="10 − E-score: shortfall from the maximum score. E_weight ÷ 100: industry weight as a proportion. The negative sign sets the direction: raw g closer to 0 is greener.">g = −(10 − E-score) × E_weight ÷ 100</Formula>
      <p>Saved raw g: <strong>{value(row?.g, 4)}</strong>. This page does not recalculate company g from rounded scores, adapter defaults or LLM ratings.</p>
      <p>The cross-market model standardizes g. A standardized value of 0 is the center of that reference distribution rather than the greenest value.</p>
    </div></details>
  </div>;
}
function ClaimSignal({ data, row, year }: { data: TalkWalkData; row?: TalkWalkFirm; year: string }) {
  const rule = data.dictionary.methodology;
  const supplied = rule?.rule === "high_talk_low_walk" && finite(rule.talk_min) && finite(rule.walk_max) && ["dataset_supplied", "builtin_pipeline"].includes(rule.provenance || "");
  const threshold = (n: number) => Math.abs(n - 10 / 3) < 1e-10 ? "10/3 (≈3.33)" : String(n);
  return <section className="workspace-panel" aria-labelledby="claim-heading">
    <div className="panel-heading"><div><h2 id="claim-heading">Environmental claims & signal</h2><p>Dictionary assessment · {year || "Year unavailable"} · {row?.source || "Source unavailable"}</p></div></div>
    <div className={styles.claimReadout}>
      <div><span>Talk <small>Claim density rank</small></span><strong>{value(row?.talk)}</strong><p>How densely the company talks about the environment; high scores do not establish credibility.</p></div>
      <div><span>Walk <small>Hard-data performance</small></span><strong>{value(row?.walk)}</strong><p>Environmental performance, using emission intensity ranks in the default method.</p></div>
      <div><span>Gap <small>Claims versus performance</small></span><strong>{signed(row?.gap)}</strong><p>Talk − Walk. A large gap alone does not trigger a signal.</p></div>
    </div>
    <p className={styles.signal} role="status"><strong>Signal · {signal(row)}</strong><span>Assessment supplied by the backend. No signal does not certify a company as safe.</span></p>
    {!row && <p className={styles.note}>Insufficient data · No dictionary assessment is available for this company in {year || "the selected year"}. Other years are not substituted.</p>}
    <details className={styles.scoreExplanation}><summary>Signal rule & Talk calculation</summary><div className={styles.scoreExplanationBody}>
      <p><strong>{supplied ? "Dataset rule" : "Reference rule"}</strong>{supplied ? ` · ${rule!.source}` : " · The active dataset has no confirmed rule. This explains the default engine only."}</p>
      <Formula symbols="Both conditions must hold. Classification comes from backend flags; this page does not recalculate those flags from displayed scores.">Talk ≥ {supplied ? threshold(rule!.talk_min) : "8"} <strong>AND</strong> Walk ≤ {supplied ? threshold(rule!.walk_max) : "10/3 (≈3.33)"}</Formula>
      <p>A large gap alone does not trigger a greenwash signal. Missing scores or classification remain Insufficient data. A signal calls for review of supporting evidence.</p>
      <p>Default Talk: report text → exclude selected business terms and nearby risk-context hits → valid claim hits ÷ valid words × 1,000 → within-year comparison-group rank → 0–10. This measures word density, not verification of each claim.</p>
      <p>{data.dictionary.scale} · Saved claim density: {value(row?.claim_per_1000)} / 1,000 words. Small samples use the same _all pooling logic as the hard-data ranks.</p>
      <div className={styles.ruleScenarios}><p><b>6 / 1 / +5</b>Talk below 8 → No signal</p><p><b>9 / 5 / +4</b>Walk above 10/3 → No signal</p><p><b>9 / 2 / +7</b>Both conditions hold → Signal</p></div>
      <p>These examples use the default rule and do not modify actual flags. Mounted datasets may use other Walk measures. LLM scores are not dictionary ranks and are not classified by this rule.</p>
    </div></details>
  </section>;
}
function SemanticEvidence({ row, year, years, onYear }: { row?: TalkWalkFirm; year: string; years: number[]; onYear: (year: string) => void }) {
  const documents = row?.documents ?? [];
  return <section className={`workspace-panel ${styles.semanticPanel}`} aria-labelledby="semantic-heading">
    <div className="panel-heading"><div><h2 id="semantic-heading">Report evidence & LLM</h2><p>LLM semantic rubric · {year || "Year unavailable"} · {row?.source || "Stored report assessments"}</p></div><YearSelect label="LLM report year" years={years} selected={year} onChange={onYear} /></div>
    <p className={styles.semanticNotice}><strong>Semantic assessment of supplied reports and hard data. Not used in the current g calculation.</strong><span>These are stored assessments; selecting a company does not run an LLM. Semantic ratings are not peer ranks and must not be combined or directly compared with E-score.</span></p>
    {!row && <p className={styles.note}>Insufficient data · No stored LLM assessment is available for this company in {year || "the selected year"}. Other years are not substituted.</p>}
    <div className={styles.documentList}>{documents.length ? documents.map((doc, index) => <article className={styles.reportEvidence} key={`${year}-${index}`}>
      <div className={styles.reportHeading}><strong>Report period · {doc.period || "Period unavailable"}</strong><span>Published / filed · {doc.filing_date || "Date unavailable"}{doc.model ? ` · ${doc.model}` : ""}</span></div>
      {doc.source_url && /^https?:\/\//i.test(doc.source_url) && <a className={styles.sourceLink} href={doc.source_url} target="_blank" rel="noreferrer">Open source document ↗<small>{doc.source_url}</small></a>}
      {doc.summary && <p className={styles.reportSummary}>{doc.summary}</p>}
      <div className={styles.evidence}>{([['Commitment evidence', doc.evidence_talk], ['Action evidence', doc.evidence_walk]] as const).map(([label, items]) => <div key={label}><h3>{label}</h3>{items?.length ? <><ul>{items.slice(0, 2).map((item, i) => <li key={i}>{evidenceText(item)}</li>)}</ul>{items.length > 2 && <details className={styles.dimensionDetails}><summary>Read all evidence ({items.length})</summary><ul>{items.slice(2).map((item, i) => <li key={i}>{evidenceText(item)}</li>)}</ul></details>}</> : <p>{missing}</p>}</div>)}</div>
      {doc.dimensions && Object.keys(doc.dimensions).length > 0 && <details className={styles.dimensionDetails}><summary>Document dimensions</summary><dl className={styles.documentDimensions}>{Object.entries(doc.dimensions).map(([k, v]) => <div key={k}><dt>{friendly(k)}</dt><dd>{evidenceText(v)}</dd></div>)}</dl></details>}
    </article>) : <p className={styles.note}>Insufficient data · No supporting LLM documents are available for this year.</p>}</div>
    <div className={styles.semanticReadout}><p>Commitment assessment <small>LLM semantic Talk</small><b>{value(row?.talk)} / 10</b></p><p>Action evidence assessment <small>LLM semantic Walk</small><b>{value(row?.walk)} / 10</b></p></div>
    <p className={styles.note}>Ratings describe the supplied evidence. Dictionary rule does not classify LLM scores.</p>
    <details className={styles.dimensionDetails}><summary>Saved LLM scores & dimensions</summary><p className={styles.note}>Original semantic Talk: {value(row?.talk)} · Walk: {value(row?.walk)} · Gap: {signed(row?.gap)} · {year || "Year unavailable"}. Original scores are preserved. Semantic Gap does not trigger dictionary classification.</p>{row?.dimensions && <div className={styles.dimensions}>{Object.entries(row.dimensions).map(([k, v]) => <article key={k}><span>{friendly(k)}</span><strong>{evidenceText(v)}</strong></article>)}</div>}</details>
  </section>;
}
function FormulaLab() {
  const [score, setScore] = useState("6"), [weight, setWeight] = useState("40");
  const s = Number(score), w = Number(weight);
  const valid = score.trim() !== "" && weight.trim() !== "" && finite(s) && finite(w) && s >= 0 && s <= 10 && w >= 0 && w <= 100;
  const g = valid ? -(10 - s) * w / 100 : null;
  return <section className="workspace-panel" aria-labelledby="lab-heading"><div className="panel-heading"><div><h2 id="lab-heading">Formula lab</h2><p>Illustrative inputs only. Does not modify data or run portfolio optimization.</p></div></div>
    <div className={styles.formulaLab}><label>E-score · Example score<input aria-label="Example E-score" type="number" min={0} max={10} step={0.1} value={score} onChange={e => setScore(e.target.value)} /></label><label>E_weight · Example industry weight<input aria-label="Example E_weight" type="number" min={0} max={100} step={1} value={weight} onChange={e => setWeight(e.target.value)} /></label><output aria-label="Example raw g" aria-live="polite"><span>Raw g · Example result</span><strong>{valid ? value(g, 3) : "Enter valid example values"}</strong></output></div>
    <p className={styles.labDirection}>{valid ? s === 10 ? "At E-score = 10, raw g is 0 regardless of industry weight." : "Higher E-score moves g toward 0. At a fixed score below 10, higher E_weight makes g more negative." : "E-score must be 0–10; E_weight must be 0–100."}</p>
    <p className={styles.note}>Raw g closer to 0 is greener. The cross-market model standardizes g, so a standardized value of 0 no longer means greenest.</p>
  </section>;
}
export function TalkWalkPage({ universe, market, datasetId, status }: { universe: Universe | null; market: Market; datasetId: string; status: DataStatus | null }) {
  const [query, setQuery] = useState(""), [selected, setSelected] = useState(""), [chooserOpen, setChooserOpen] = useState(true);
  const [hardYear, setHardYear] = useState(""), [semanticYear, setSemanticYear] = useState("");
  const [loaded, setLoaded] = useState<{ firm: string; data: TalkWalkData } | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(false), [retry, setRetry] = useState(0);
  const company = universe?.get(selected);
  const data = loaded?.firm === selected && loaded.data.dataset_id === datasetId ? loaded.data : null;
  useEffect(() => {
    if (!selected) return;
    let active = true; setLoaded(null); setError(""); setLoading(true);
    fetchTalkWalk(market, selected).then(result => {
      if (!active) return;
      if (result.dataset_id !== datasetId) throw new Error("Dataset response does not match the active selection. Please retry.");
      setLoaded({ firm: selected, data: result });
      setHardYear(String(yearsOf(result.environmental?.firms ?? [])[0] ?? yearsOf(result.dictionary.firms)[0] ?? yearsOf(result.semantic_llm.firms)[0] ?? ""));
      setSemanticYear(String(yearsOf(result.semantic_llm.firms)[0] ?? yearsOf(result.environmental?.firms ?? [])[0] ?? yearsOf(result.dictionary.firms)[0] ?? ""));
    }).catch(err => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selected, market, datasetId, retry]);
  const allYears = [...new Set(yearsOf([...(data?.environmental?.firms ?? []), ...(data?.dictionary.firms ?? []), ...(data?.semantic_llm.firms ?? [])]))];
  const environmental = forYear((data?.environmental?.firms ?? []).filter(row => row.firm_id === selected), hardYear);
  const dictionary = forYear((data?.dictionary.firms ?? []).filter(row => row.firm_id === selected), hardYear);
  const semantic = forYear((data?.semantic_llm.firms ?? []).filter(row => row.firm_id === selected), semanticYear);
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = [...(universe?.values() ?? [])].filter(c => words.every(word => `${c.name} ${c.ticker} ${c.sector}`.toLowerCase().includes(word)));
  function chooseCompany(ticker: string) {
    setChooserOpen(false);
    if (ticker === selected) return;
    setLoaded(null); setSelected(ticker); setError(""); setHardYear(""); setSemanticYear("");
  }
  return <div className={`workspace-page ${styles.page}`}>
    <div className="workspace-heading"><div><span className="workspace-eyebrow">ENVIRONMENTAL EVIDENCE</span><h1>Talk &amp; Walk</h1><p>Understand environmental performance, then review the claims and evidence behind it.</p></div></div>
    <section className="workspace-panel"><div className="panel-heading"><div><h2>{company?.name || (selected ? selected : "Select a company")}</h2><p>{selected ? `${selected} · ${company?.sector || "Sector unavailable"}` : `${universe?.size ?? 0} companies in the selected listing market.`}</p></div>{selected && <Button kind="secondary" onClick={() => setChooserOpen(open => !open)}>{chooserOpen ? "Close company selection" : "Change company"}</Button>}</div>
      <p className={styles.datasetContext}>{datasetId === "builtin" ? "Built-in dataset" : `Mounted dataset · ${datasetId}`} <span>· {status?.dataset_id === datasetId ? dataLabel(status) : "Loading dataset status…"}</span></p>
      <div hidden={!!selected && !chooserOpen}><div className="company-keyword-input"><MagnifyingGlass size={19} /><input value={query} aria-label="Search Talk & Walk companies" placeholder="Search company, ticker or sector" onChange={e => setQuery(e.target.value)} /></div><div className={styles.companyChoices}>{matches.slice(0, 6).map(c => <button type="button" key={c.ticker} aria-pressed={selected === c.ticker} onClick={() => chooseCompany(c.ticker)}><strong>{c.name}</strong><small>{c.ticker} · {c.sector}</small></button>)}</div>{matches.length > 6 && <p className={styles.note}>Showing 6 of {matches.length} matches. Search to find your company.</p>}{!matches.length && <p className={styles.note} role="status">{universe ? "No matching companies in this market." : "Loading companies…"}</p>}</div>
    </section>
    {!selected && <section className="workspace-panel"><p className={styles.note}>Select a company to explore its environmental scores, calculation pathway and stored report evidence.</p></section>}
    {selected && !data && <section className="workspace-panel">{error ? <><p className="form-error" role="alert">{error}</p><Button kind="secondary" onClick={() => setRetry(n => n + 1)}>Retry company evidence</Button></> : <p role="status">{loading ? "Loading company evidence…" : "Waiting for company data…"}</p>}</section>}
    {data && <>
      <section className={`workspace-panel ${styles.primaryPanel}`} aria-labelledby="environment-heading"><div className="panel-heading"><div><h2 id="environment-heading">Environmental performance</h2><p>Hard-data assessment · {hardYear || "Year unavailable"} · {environmental?.source || "Source unavailable"}</p></div><YearSelect label="Hard-data year" years={allYears} selected={hardYear} onChange={setHardYear} /></div>
        {hardYear && semanticYear && hardYear !== semanticYear && <p className={styles.yearNotice} role="status">Years differ · Hard data {hardYear} / LLM report {semanticYear}. These are separate assessments.</p>}
        <div className={styles.primaryMetrics}><article><span>E-score <small>Relative performance</small></span><strong>{value(environmental?.e_score)}</strong><p>Emission intensity rank in the default method. Higher means better relative performance.</p></article><article><span>E_weight <small>Industry environmental weight</small></span><strong>{value(environmental?.e_weight)}</strong><p>Environmental importance of the industry, separate from portfolio allocation.</p></article><article><span>Company g <small>Greenness</small></span><strong>{value(environmental?.g, 4)}</strong><p>Combines E-score and industry weight. Raw g closer to 0 is greener.</p></article></div>
        <p className={styles.note}>These metrics feed portfolio green constraints. The LLM assessment below adds report evidence and does not enter the current g calculation.</p>
        {!environmental && <p className={styles.note}>Insufficient data · No unique environmental score record is available for this year. Other years and company-list defaults are not substituted.</p>}
        <CalculationSteps row={environmental} year={hardYear} />
      </section>
      <ClaimSignal data={data} row={dictionary} year={hardYear} />
      <SemanticEvidence key={`${selected}:${semanticYear}`} row={semantic} year={semanticYear} years={allYears} onYear={setSemanticYear} />
      <FormulaLab />
      <section className="workspace-panel"><div className="panel-heading"><div><h2>From company to portfolio</h2></div></div><p className={styles.portfolioPath}>Company E-score → Holding-weighted average → Portfolio green score</p><p className={styles.portfolioPath}>Company g → Holding-weighted average → Portfolio g → Green constraint</p><p className={styles.note}>Portfolio E-score and portfolio g are different metrics. Green preference constrains average portfolio g rather than filtering each stock. Holding weight is capital allocation; industry E_weight is environmental importance; financial beta is sensitivity to a return factor.</p></section>
      {data.limitations.length > 0 && <details className={styles.coverageNotes}><summary>Coverage notes</summary><ul className={styles.limitations}>{data.limitations.map(note => <li key={note}>{note}</li>)}</ul></details>}
    </>}
  </div>;
}
