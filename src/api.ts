import type { Company } from "./data";
import { datasetFetch } from "./dataset";

export async function fetchCompanies(market: "hk" | "tw" | "all" = "all"): Promise<Company[] | null> {
  try {
    const res = await datasetFetch(`/api/companies?market=${market}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export type PortfolioStats = {
  ann_ret: number | null;
  ann_vol: number | null;
  g_avg: number | null;
  exposures: Record<string, number>;
  n_positions: number;
  top_weight: number;
  effective_n: number;
};

export type Trade = {
  firm_id: string;
  w_current: number;
  w_target: number;
  dw: number;
  capital_delta: number;
  side: string;
  capital_current: number;
  capital_target: number;
  price: number | null;
  shares_current: number | null;
  shares_target: number | null;
  shares_delta: number | null;
};

export type Recommendation = {
  dataset_id?: string;
  capital_currency?: string;
  pricing_currency?: string;
  base_currency?: string;
  model_currency?: string;
  return_basis?: string;
  model_period?: { start: string | null; end: string | null; n_months: number };
  pricing_timing?: Record<string, { price_date: string | null; fx_month: string | null }>;
  params: { vol_target_ann: number | null; g_target_pctl: number | null; n_candidates: number };
  total_capital: number;
  new_capital: number;
  target_capital: number;
  turnover: number;
  before: PortfolioStats;
  after: PortfolioStats;
  trades: Trade[];
  unmodeled: { firm_id: string; capital: number; weight: number }[];
};

export function modelContext(rec: Recommendation) {
  const currency = rec.model_currency || "currency unavailable";
  const basis = rec.return_basis === "excess" ? "excess return" : rec.return_basis || "return basis unavailable";
  const period = rec.model_period?.start && rec.model_period.end ? ` · observations ${rec.model_period.start} – ${rec.model_period.end}` : "";
  return `Model: ${currency}-based ${basis} and risk${period}. Capital and prices: ${rec.capital_currency || "HKD"}.`;
}

export async function recommendPortfolio(body: {
  holdings: Record<string, number>;
  risk_score: number;
  green_score: number;
  max_new_capital: number;
  market: "hk" | "tw" | "all";
  capital_currency?: "HKD";
  filters?: { include_industries: string[] };
}): Promise<Recommendation | { error: string }> {
  try {
    const res = await datasetFetch("/api/portfolio/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      return { error: typeof err?.detail === "string" ? err.detail : "The engine could not produce a recommendation." };
    }
    return await res.json();
  } catch {
    return { error: "The engine is not reachable." };
  }
}

export type SectorOption = { sector: string; n: number; industries: { industry: string; n: number }[] };

export async function fetchFilterOptions(market: "hk" | "tw" | "all"): Promise<SectorOption[]> {
  try {
    const res = await datasetFetch(`/api/portfolio/filters?market=${market}`);
    if (!res.ok) return [];
    return (await res.json()).sectors ?? [];
  } catch {
    return [];
  }
}
