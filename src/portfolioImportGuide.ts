import { importTemplate } from "./portfolio";

export const portfolioColumns = [
  { name: "stock_code", required: true, type: "text", example: "0700.HK", rule: "Use the exchange-qualified ticker and preserve leading zeros.", aliases: ["ticker", "symbol"] },
  { name: "current_holding_value", required: true, type: "positive number", example: "24000", rule: "Current market value of the whole position, in the row currency. Not cost basis or allocation percentage.", aliases: ["current_value", "market_value", "Total Market Value"] },
  { name: "currency", required: true, type: "text", example: "HKD", rule: "Three-letter currency code. Foreign values require dated FX in the active dataset.", aliases: [] },
  { name: "company_name", required: false, type: "text", example: "Tencent Holdings", rule: "Optional display name. Quote CSV cells containing commas.", aliases: ["name"] },
  { name: "exchange", required: false, type: "text", example: "XHKG", rule: "Optional venue label; does not replace the ticker suffix.", aliases: ["market"] },
  { name: "units", required: false, type: "positive integer", example: "100", rule: "Optional number of shares. Leave blank if unavailable.", aliases: ["quantity", "shares"] },
  { name: "unit_price", required: false, type: "positive number", example: "240", rule: "In the row currency. If both units and price are supplied, their product must match position value within 0.01.", aliases: ["share_price", "price"] },
  { name: "as_of_date", required: false, type: "YYYY-MM-DD", example: "2026-10-03", rule: "Use a common valuation date for all holdings; leave blank if unavailable.", aliases: ["valuation_date"] },
  { name: "asset_class", required: false, type: "text", example: "Equity", rule: "Defaults to Equity. For cash use Cash with stock_code set to a hyphen (-).", aliases: ["asset_type"] },
] as const;

export const portfolioImportSchema = {
  version: 1,
  format: "csv",
  description: "Green Street portfolio CSV format. This JSON describes CSV columns; upload holdings as CSV, not JSON.",
  encoding: "UTF-8",
  delimiter: ",",
  max_bytes: 10 * 1024 * 1024,
  required_columns: portfolioColumns.filter(c => c.required).map(c => c.name),
  columns: portfolioColumns,
  reporting_currency: "HKD",
  rules: ["One header row and one or more holding rows. No totals or notes rows.", "Use positive decimal numbers without currency symbols or percentage signs.", "Quote cells containing commas. Each row must have the same number of columns as the header.", "Use actual holdings only. Unknown companies may remain unassessed; ticker lookup does not verify the supplied market values.", "FX conversion is performed during import using the selected dataset. Do not silently convert currencies in an AI export."],
};

export const portfolioAiInstructions = `Convert the holdings I provide below into a Green Street portfolio CSV.

Use this header exactly:
stock_code,exchange,company_name,current_holding_value,currency,units,unit_price,as_of_date

Rules:
- Use only the holdings and figures I supply. Never invent companies, ticker symbols, market values, currencies, share counts, prices or dates.
- stock_code, current_holding_value and currency are required. If any is missing or ambiguous, ask me for it before generating the CSV.
- Use exchange-qualified ticker symbols such as 0700.HK, 2330.TW or a .TWO symbol. Preserve leading zeros. If the exchange is unclear, ask; do not guess from the company name.
- current_holding_value is the current market value of the entire position in the declared currency, not purchase cost, profit, allocation percentage or a unit price.
- Use positive decimal numbers without currency symbols, thousands separators or percentage signs. Use a three-letter currency code such as HKD, TWD or USD. Do not perform FX conversion.
- Optional fields may be blank. units must be a positive whole number. unit_price is in the row currency. If both are supplied, units multiplied by unit_price must equal current_holding_value within 0.01; ask me to resolve inconsistencies.
- as_of_date must be YYYY-MM-DD and the same for every holding. Leave it blank when not supplied.
- Quote company names containing commas using standard CSV quoting. Keep the same column count on every row.
- Do not add totals, notes, ESG scores, explanations or extra columns. When the required information is complete, return only the CSV in one code block so I can save it as a UTF-8 .csv file.

My actual holdings:
[Paste the holdings table or export here]`;

export const portfolioExample = importTemplate;
