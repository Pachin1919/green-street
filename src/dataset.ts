export type Market = "all" | "hk" | "tw";
const selectionKey = "green-street-dataset";
let activeSelection: string | undefined;
export function selectedDataset(): string {
  if (activeSelection) return activeSelection;
  try { activeSelection = localStorage.getItem(selectionKey) || "builtin"; } catch { activeSelection = "builtin"; }
  return activeSelection;
}
export function selectDataset(id: string) {
  activeSelection = id;
  try { localStorage.setItem(selectionKey, id); } catch { /* The current tab still works without persistence. */ }
}
export function datasetHeaders(): Record<string, string> { return { "X-Dataset-Id": selectedDataset() }; }
export async function datasetFetch(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("X-Dataset-Id", selectedDataset());
  return fetch(url, { ...init, headers });
}
export type DateRange = { start: string | null; end: string | null };
export type MarketStatus = { status: string; company_count: number; data_dates: DateRange; sources: string[] };
export type DataStatus = {
  dataset_id: string; mode: "demo" | "snapshot" | "live" | "missing"; label: string; is_latest: boolean;
  snapshot_date: string | null; markets: Partial<Record<"hk" | "tw", MarketStatus>>;
  missing_markets: string[]; limitations: string[];
};
export type DataSources = {
  dataset_id: string; sources: { key: string; kind: string; market: string; available: boolean; rows: number; data_dates: DateRange; source: string }[];
  capabilities: { bundle_import: boolean; native_api_connector: boolean; native_sql_connector: boolean };
};
export type FxRate = { pair: string; rate: number; date: string; source: string; is_latest: boolean };
export type FxData = { dataset_id: string; rates: FxRate[]; is_latest: boolean };
export type TalkWalkDocument = {
  filing_date?: string; period?: string; source_url?: string; summary?: string; model?: string;
  evidence_talk?: unknown[]; evidence_walk?: unknown[]; dimensions?: Record<string, unknown>;
};
export type TalkWalkFirm = {
  firm_id: string; year?: number; talk: number | null; walk: number | null; gap: number | null;
  dimensions?: Record<string, unknown>; documents?: TalkWalkDocument[];
  greenwasher?: boolean | null; greenhusher?: boolean | null; assessment_status?: string;
  source?: string; rank_group?: string | null; claim_per_1000?: number | null;
};
export type EnvironmentalFirm = {
  firm_id: string; year?: number; e_score: number | null; e_weight: number | null; g: number | null;
  provider?: string | null; sector?: string | null; intensity?: number | null;
  scope1?: number | null; scope2?: number | null; revenue?: number | null;
  rank?: number | null; comparison_count?: number | null; rank_group?: string | null;
  walk_matches_e_score?: boolean; default_hard_path?: boolean; source?: string;
  input_source?: string | null; dataset_source?: string; score_path_provenance?: string;
  missing_fields?: string[];
};
export type TalkWalkData = {
  dataset_id: string; market: string; assessment_status?: string;
  environmental?: { firms: EnvironmentalFirm[]; methodology?: Record<string, unknown> };
  semantic_llm: { kind: string; scale: string; firms: TalkWalkFirm[]; coverage: { firms: number; documents: number }; methodology?: { classification: string; gap_is_classifier: boolean } };
  dictionary: { kind: string; scale: string; firms: TalkWalkFirm[]; methodology?: { rule: string; talk_min: number; walk_max: number; gap_is_classifier: boolean; source: string; provenance?: string } };
  limitations: string[];
};
export async function readDataset<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await datasetFetch(path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.detail === "string" ? body.detail : `Data request failed (${response.status}).`);
  }
  return response.json();
}
export const fetchDataStatus = (market: Market) => readDataset<DataStatus>(`/api/data/status?market=${market}`);
export const fetchDataSources = () => readDataset<DataSources>("/api/data/sources");
export const fetchFx = () => readDataset<FxData>("/api/data/fx");
export const fetchTalkWalk = (market: Market, firm: string) => readDataset<TalkWalkData>(`/api/talk-walk?market=${market}&firm_id=${encodeURIComponent(firm)}`);
export function dataLabel(status: DataStatus | null) {
  if (!status || status.mode === "missing") return "Database data unavailable";
  if (status.mode === "demo") return "Demo data · Illustrative";
  const label = status.mode === "live" && status.is_latest ? "Live database" : "Latest database data";
  return `${label} · ${status.snapshot_date || "date unavailable"}`;
}
export function dateRange(range?: DateRange) {
  if (!range?.end) return "Date unavailable";
  return range.start && range.start !== range.end ? `${range.start} – ${range.end}` : range.end;
}
