import { useEffect, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { dataLabel, fetchTalkWalk } from "./dataset";
import type { DataStatus, EnvironmentalFirm, Market, TalkWalkData, TalkWalkFirm } from "./dataset";
import type { Universe } from "./live";
import { Button } from "./ui";
import styles from "./DataWorkspace.module.css";

const missing = "当前数据未提供";
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
  if (!row || !finite(row.talk) || !finite(row.walk) || !finite(row.gap) || row.assessment_status === "insufficient_data") return "Insufficient data · 暂无法评估";
  if (row.greenwasher === true) return "Greenwash signal detected · 漂绿信号";
  if (row.greenhusher === true) return "Quiet-action signal detected · 少说多做信号";
  if (row.greenwasher == null || row.greenhusher == null) return "Insufficient data · 分类结果未提供";
  return "No signal detected · 未触发信号";
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
    <p className={styles.flow} aria-label="Environmental calculation flow">排放与收入 <span>→</span> 排放强度 <span>→</span> E-score <span>→</span> 行业 E_weight <span>→</span> g</p>
    <p className={styles.note}>{confirmed ? "硬数据 Walk = 当前 E-score · 当前记录提供了默认碳强度路径说明。" : "默认路径学习说明 · 当前记录未确认使用默认碳强度路径；不能直接认定硬数据 Walk = 当前 E-score。"}</p>
    <details><summary>01 · Emissions & revenue <small>排放与收入</small></summary><div className={styles.stepBody}>
      <p>Scope 1：公司自身活动的直接排放。Scope 2：外购电力、热力等能源产生的间接排放。收入用于比较不同规模的公司。</p>
      <dl className={styles.inputFacts}><div><dt>Scope 1 · tCO₂e</dt><dd>{value(row?.scope1)}</dd></div><div><dt>Scope 2 · tCO₂e</dt><dd>{value(row?.scope2)}</dd></div><div><dt>Revenue · USD million</dt><dd>{value(row?.revenue)}</dd></div></dl>
      <p>输入来源：{row?.input_source || missing}。评分表：{row?.source || missing}。</p>
      <p>只显示该公司、该年份保存的输入。不同日期、币种与单位需要对齐，不能把缺失数当作 0。</p>
    </div></details>
    <details><summary>02 · Emission intensity <small>排放强度</small></summary><div className={styles.stepBody}>
      <Formula symbols="分子：Scope 1 + Scope 2（tCO₂e）；分母：收入（百万美元）。结果单位：tCO₂e / USD million。">排放强度 =（Scope 1 + Scope 2）÷ 收入</Formula>
      <p>当前保存的强度：<strong>{value(row?.intensity)}</strong>。默认路径中越低越好；此处不重算或反推原始输入。</p>
      <p>默认评分脚本在合计 Scope 1 与 Scope 2 时会对缺失项填 0；这里保留原始缺失状态，避免把未披露理解成零排放。</p>
    </div></details>
    <details><summary>03 · E-score <small>同行相对表现</small></summary><div className={styles.stepBody}>
      <Formula symbols="排名 r：排放强度从低到高的名次，并列取平均。n：比较组中有有效强度的公司数；不是全部上市公司数。">E-score = 10 × [1 − (r − 1) ÷ (n − 1)]</Formula>
      <dl className={styles.inputFacts}><div><dt>Sector · 行业</dt><dd>{row?.sector || missing}</dd></div><div><dt>Year · 年份</dt><dd>{year || missing}</dd></div><div><dt>Rank group · 实际比较组</dt><dd>{row?.rank_group === "_all" ? "_all · 小行业合并组" : row?.rank_group || missing}</dd></div><div><dt>Rank r · 名次</dt><dd>{value(row?.rank)}</dd></div><div><dt>Group n · 公司数</dt><dd>{value(row?.comparison_count, 0)}</dd></div></dl>
      <p>默认源码：同年同行业至少 5 家时在该行业内排名；不足 5 家的行业合并到该年的 _all 小行业组，其他大行业不会加入。实际比较组仅在数据提供时显示。</p>
      <p>组内只有 1 个有效值时给 5 分；缺失强度保持缺失。7.8 是相对排名分数，不代表“78% 环保”。</p>
    </div></details>
    <details><summary>04 · E_weight <small>行业环境权重</small></summary><div className={styles.stepBody}>
      <Formula symbols="分子与分母分别合计该行业的排放与收入，得到行业整体的排放强度。">行业强度 = 行业排放总和 ÷ 行业收入总和</Formula>
      <Formula symbols="p：行业强度在同一年所有行业中的百分位排名，采用平均名次。默认映射区间 5–50；最低实际值取决于行业数。">E_weight = 5 + 45 × p</Formula>
      <p>当前保存的 E_weight：<strong>{value(row?.e_weight)}</strong>。行业强度越高，环境表现差距在 g 中占的权重越大。它不是持仓资金比例。</p>
      <p>行业合计与百分位未作为当前页面输入提供，因此不由公司权重反推。源码默认使用碳强度作为行业重要性的代理。</p>
      <p>实际参与权重计算的样本：有 Walk 且有行业信息的记录。源码从保存的排放量 level ÷ intensity 恢复收入；零强度等无法恢复收入的记录，用同行同年的收入中位数补齐，再计算行业合计。这些中间输入并未全部保存，不能把所有公司的披露收入直接视为本次权重的输入。</p>
    </div></details>
    <details><summary>05 · Company g <small>公司绿色程度</small></summary><div className={styles.stepBody}>
      <Formula symbols="10 − E-score：距离满分的差距；E_weight ÷ 100：行业权重的比例。负号定义方向，原始 g 越接近 0 越绿。">g = −(10 − E-score) × E_weight ÷ 100</Formula>
      <p>保存的原始 g：<strong>{value(row?.g, 4)}</strong>。页面不使用四舍五入后的分数、适配层默认值或 LLM 评分重新计算公司 g。</p>
      <p>跨市场模型会标准化 g；标准化后的 0 表示该标准化基准的中心，不再表示最绿。</p>
    </div></details>
  </div>;
}
function ClaimSignal({ data, row, year }: { data: TalkWalkData; row?: TalkWalkFirm; year: string }) {
  const rule = data.dictionary.methodology;
  const supplied = rule?.rule === "high_talk_low_walk" && finite(rule.talk_min) && finite(rule.walk_max) && ["dataset_supplied", "builtin_pipeline"].includes(rule.provenance || "");
  const threshold = (n: number) => Math.abs(n - 10 / 3) < 1e-10 ? "10/3 (≈3.33)" : String(n);
  return <section className="workspace-panel" aria-labelledby="claim-heading">
    <div className="panel-heading"><div><h2 id="claim-heading">Environmental claims & signal <span className={styles.translation}>环境主张与信号</span></h2><p>Dictionary assessment · {year || "Year unavailable"} · {row?.source || "Source unavailable"}</p></div></div>
    <div className={styles.claimReadout}>
      <div><span>Talk <small>主张词密度排名</small></span><strong>{value(row?.talk)}</strong><p>表达有多密集；高分不表示承诺可信。</p></div>
      <div><span>Walk <small>硬数据环境表现</small></span><strong>{value(row?.walk)}</strong><p>硬数据量表，默认采用排放强度排名。</p></div>
      <div><span>Gap <small>表达与表现差距</small></span><strong>{signed(row?.gap)}</strong><p>Talk − Walk；差距大不自动触发信号。</p></div>
    </div>
    <p className={styles.signal} role="status"><strong>Signal · {signal(row)}</strong><span>后端评估状态；未触发信号不等于公司安全。</span></p>
    {!row && <p className={styles.note}>Insufficient data · No dictionary assessment is available for this company in {year || "the selected year"}. 不回退到其他年份。</p>}
    <details className={styles.scoreExplanation}><summary>Signal rule & Talk calculation <span>判定规则与文本计算</span></summary><div className={styles.scoreExplanationBody}>
      <p><strong>{supplied ? "Dataset rule · 当前数据集规则" : "Reference rule · 参考规则"}</strong>{supplied ? ` · ${rule!.source}` : " · 当前数据集未提供可确认的规则，以下仅解释默认引擎。"}</p>
      <Formula symbols="两项必须同时满足。实际分类读取后端 flags；页面 does not recalculate those flags，不会用显示值重新判定。">Talk ≥ {supplied ? threshold(rule!.talk_min) : "8"} <strong>AND</strong> Walk ≤ {supplied ? threshold(rule!.walk_max) : "10/3 (≈3.33)"}</Formula>
      <p>A large gap alone does not trigger a greenwash signal. 缺失分数或分类状态保持 Insufficient data；信号只提示需要核对证据。</p>
      <p>默认 Talk：报告文本 → 排除部分业务词及邻近风险语境的词 → 有效主张词次数 ÷ 有效词数 × 1,000 → 同年比较组排名 → 0–10。它是词密度排名，不是逐句承诺核验。</p>
      <p>{data.dictionary.scale} · 当前主张词密度：{value(row?.claim_per_1000)} / 1,000 words。默认小样本处理与硬数据排名使用同样的 _all 合并逻辑。</p>
      <div className={styles.ruleScenarios}><p><b>6 / 1 / +5</b>Talk 未到 8 → 未触发</p><p><b>9 / 5 / +4</b>Walk 高于 10/3 → 未触发</p><p><b>9 / 2 / +7</b>两个条件均满足 → 触发</p></div>
      <p>以上为默认规则学习示例，不修改真实 flags。Mounted datasets may use other Walk measures. LLM 分数不属于这套字典排名，不套用此规则。</p>
    </div></details>
  </section>;
}
function SemanticEvidence({ row, year, years, onYear }: { row?: TalkWalkFirm; year: string; years: number[]; onYear: (year: string) => void }) {
  const documents = row?.documents ?? [];
  return <section className={`workspace-panel ${styles.semanticPanel}`} aria-labelledby="semantic-heading">
    <div className="panel-heading"><div><h2 id="semantic-heading">Report evidence & LLM <span className={styles.translation}>报告证据与辅助评价</span></h2><p>LLM semantic rubric · {year || "Year unavailable"} · {row?.source || "Stored report assessments"}</p></div><YearSelect label="LLM report year · 报告年份" years={years} selected={year} onChange={onYear} /></div>
    <p className={styles.semanticNotice}><strong>根据提供的报告文本与硬数据进行语义评价；不参与当前 g 计算。</strong><span>读取已保存的评价，选择公司不会实时运行 LLM。语义量表不是同行排名，不与 E-score 相加、平均或比较高低。</span></p>
    {!row && <p className={styles.note}>Insufficient data · No stored LLM assessment is available for this company in {year || "the selected year"}. 不回退到其他年份。</p>}
    <div className={styles.documentList}>{documents.length ? documents.map((doc, index) => <article className={styles.reportEvidence} key={`${year}-${index}`}>
      <div className={styles.reportHeading}><strong>Report period · {doc.period || "Period unavailable"}</strong><span>Published / filed · {doc.filing_date || "Date unavailable"}{doc.model ? ` · ${doc.model}` : ""}</span></div>
      {doc.source_url && /^https?:\/\//i.test(doc.source_url) && <a className={styles.sourceLink} href={doc.source_url} target="_blank" rel="noreferrer">Open source document ↗<small>{doc.source_url}</small></a>}
      {doc.summary && <p className={styles.reportSummary}>{doc.summary}</p>}
      <div className={styles.evidence}>{([['Commitment evidence · 承诺依据', doc.evidence_talk], ['Action evidence · 行动依据', doc.evidence_walk]] as const).map(([label, items]) => <div key={label}><h3>{label}</h3>{items?.length ? <><ul>{items.slice(0, 2).map((item, i) => <li key={i}>{evidenceText(item)}</li>)}</ul>{items.length > 2 && <details className={styles.dimensionDetails}><summary>Read all evidence · 完整依据 ({items.length})</summary><ul>{items.slice(2).map((item, i) => <li key={i}>{evidenceText(item)}</li>)}</ul></details>}</> : <p>{missing}</p>}</div>)}</div>
      {doc.dimensions && Object.keys(doc.dimensions).length > 0 && <details className={styles.dimensionDetails}><summary>Document dimensions · 报告分项评分</summary><dl className={styles.documentDimensions}>{Object.entries(doc.dimensions).map(([k, v]) => <div key={k}><dt>{friendly(k)}</dt><dd>{evidenceText(v)}</dd></div>)}</dl></details>}
    </article>) : <p className={styles.note}>Insufficient data · No supporting LLM documents are available for this year.</p>}</div>
    <div className={styles.semanticReadout}><p>Commitment assessment <small>LLM 承诺评价（原语义 Talk）</small><b>{value(row?.talk)} / 10</b></p><p>Action evidence assessment <small>LLM 行动证据评价（原语义 Walk）</small><b>{value(row?.walk)} / 10</b></p></div>
    <p className={styles.note}>语义评分描述所提供材料中的主张与行动依据。Dictionary rule does not classify LLM scores.</p>
    <details className={styles.dimensionDetails}><summary>Saved LLM scores & dimensions · 保存的分项评分</summary><p className={styles.note}>Original semantic Talk: {value(row?.talk)} · Walk: {value(row?.walk)} · Gap: {signed(row?.gap)} · {year || "Year unavailable"}。保留原始评分；语义 Gap 不触发字典漂绿分类。</p>{row?.dimensions && <div className={styles.dimensions}>{Object.entries(row.dimensions).map(([k, v]) => <article key={k}><span>{friendly(k)}</span><strong>{evidenceText(v)}</strong></article>)}</div>}</details>
  </section>;
}
function FormulaLab() {
  const [score, setScore] = useState("6"), [weight, setWeight] = useState("40");
  const s = Number(score), w = Number(weight);
  const valid = score.trim() !== "" && weight.trim() !== "" && finite(s) && finite(w) && s >= 0 && s <= 10 && w >= 0 && w <= 100;
  const g = valid ? -(10 - s) * w / 100 : null;
  return <section className="workspace-panel" aria-labelledby="lab-heading"><div className="panel-heading"><div><h2 id="lab-heading">Formula lab <span className={styles.translation}>公式学习示例</span></h2><p>示例值，不修改数据，不运行组合优化。</p></div></div>
    <div className={styles.formulaLab}><label>E-score · 示例分数<input aria-label="Example E-score" type="number" min={0} max={10} step={0.1} value={score} onChange={e => setScore(e.target.value)} /></label><label>E_weight · 示例行业权重<input aria-label="Example E_weight" type="number" min={0} max={100} step={1} value={weight} onChange={e => setWeight(e.target.value)} /></label><output aria-label="Example raw g" aria-live="polite"><span>Raw g · 示例原始值</span><strong>{valid ? value(g, 3) : "请输入有效范围内的示例值"}</strong></output></div>
    <p className={styles.labDirection}>{valid ? s === 10 ? "E-score = 10 时，原始 g = 0；调整行业权重仍为 0。" : "提高 E-score → g 更接近 0；E-score 不变时，提高 E_weight → g 更负。" : "E-score 范围 0–10；E_weight 范围 0–100。"}</p>
    <p className={styles.note}>原始 g 越接近 0 越绿。跨市场模型会标准化 g，标准化后的 0 不再表示最绿。</p>
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
    <div className="workspace-heading"><div><span className="workspace-eyebrow">ENVIRONMENTAL EVIDENCE</span><h1>Talk &amp; Walk</h1><p>从公司环境表现到报告证据：先理解 E-score 与 g，再看企业说了什么、做了什么。</p></div></div>
    <section className="workspace-panel"><div className="panel-heading"><div><h2>{company?.name || (selected ? selected : "Select a company")}</h2><p>{selected ? `${selected} · ${company?.sector || "Sector unavailable"}` : `${universe?.size ?? 0} companies in the selected listing market.`}</p></div>{selected && <Button kind="secondary" onClick={() => setChooserOpen(open => !open)}>{chooserOpen ? "Close company selection" : "Change company"}</Button>}</div>
      <p className={styles.datasetContext}>{datasetId === "builtin" ? "Built-in dataset" : `Mounted dataset · ${datasetId}`} <span>· {status?.dataset_id === datasetId ? dataLabel(status) : "Loading dataset status…"}</span></p>
      <div hidden={!!selected && !chooserOpen}><div className="company-keyword-input"><MagnifyingGlass size={19} /><input value={query} aria-label="Search Talk & Walk companies" placeholder="Search company, ticker or sector" onChange={e => setQuery(e.target.value)} /></div><div className={styles.companyChoices}>{matches.slice(0, 6).map(c => <button type="button" key={c.ticker} aria-pressed={selected === c.ticker} onClick={() => chooseCompany(c.ticker)}><strong>{c.name}</strong><small>{c.ticker} · {c.sector}</small></button>)}</div>{matches.length > 6 && <p className={styles.note}>Showing 6 of {matches.length} matches. Search to find your company.</p>}{!matches.length && <p className={styles.note} role="status">{universe ? "No matching companies in this market." : "Loading companies…"}</p>}</div>
    </section>
    {!selected && <section className="workspace-panel"><p className={styles.note}>选择公司，查看环境主指标、评分链路与保存的报告依据。</p></section>}
    {selected && !data && <section className="workspace-panel">{error ? <><p className="form-error" role="alert">{error}</p><Button kind="secondary" onClick={() => setRetry(n => n + 1)}>Retry company evidence</Button></> : <p role="status">{loading ? "Loading company evidence…" : "Waiting for company data…"}</p>}</section>}
    {data && <>
      <section className={`workspace-panel ${styles.primaryPanel}`} aria-labelledby="environment-heading"><div className="panel-heading"><div><h2 id="environment-heading">Environmental performance <span className={styles.translation}>主要环境指标</span></h2><p>Hard-data assessment · {hardYear || "Year unavailable"} · {environmental?.source || "Source unavailable"}</p></div><YearSelect label="Hard-data year · 评分年份" years={allYears} selected={hardYear} onChange={setHardYear} /></div>
        {hardYear && semanticYear && hardYear !== semanticYear && <p className={styles.yearNotice} role="status">Years differ · 硬数据 {hardYear} / LLM 报告 {semanticYear}，不是同一次评价。</p>}
        <div className={styles.primaryMetrics}><article><span>E-score <small>环境相对表现</small></span><strong>{value(environmental?.e_score)}</strong><p>默认按公司排放强度排名，越高代表相对表现越好。</p></article><article><span>E_weight <small>行业环境权重</small></span><strong>{value(environmental?.e_weight)}</strong><p>行业环境重要性的权重；不是持仓比例。</p></article><article><span>Company g <small>公司绿色程度</small></span><strong>{value(environmental?.g, 4)}</strong><p>E-score 与行业权重合成；原始 g 越接近 0 越绿。</p></article></div>
        <p className={styles.note}>这组主指标连接组合的绿色约束。下方 LLM 只补充报告依据，不进入当前 g 计算。</p>
        {!environmental && <p className={styles.note}>Insufficient data · 该年份未提供唯一的环境评分记录，不使用其他年份或公司列表的默认值。</p>}
        <CalculationSteps row={environmental} year={hardYear} />
      </section>
      <ClaimSignal data={data} row={dictionary} year={hardYear} />
      <SemanticEvidence key={`${selected}:${semanticYear}`} row={semantic} year={semanticYear} years={allYears} onYear={setSemanticYear} />
      <FormulaLab />
      <section className="workspace-panel"><div className="panel-heading"><div><h2>From company to portfolio <span className={styles.translation}>连接到投资组合</span></h2></div></div><p className={styles.portfolioPath}>公司 E-score → 持仓加权 → Portfolio green score</p><p className={styles.portfolioPath}>公司 g → 持仓加权 → 组合 g → 绿色约束</p><p className={styles.note}>组合 E-score 与组合 g 是不同指标。绿色偏好约束组合平均 g，不是逐股过滤。持仓权重是资金占比，行业 E_weight 是环境权重，金融 beta 是收益对因子的敏感度——三者含义不同。</p></section>
      {data.limitations.length > 0 && <details className={styles.coverageNotes}><summary>Coverage notes · 数据范围说明</summary><ul className={styles.limitations}>{data.limitations.map(note => <li key={note}>{note}</li>)}</ul></details>}
    </>}
  </div>;
}
