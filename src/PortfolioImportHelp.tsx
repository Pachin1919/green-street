import { useState } from "react";
import { Copy } from "@phosphor-icons/react";
import { portfolioAiInstructions, portfolioColumns, portfolioExample } from "./portfolioImportGuide";
import { Button } from "./ui";
import styles from "./PortfolioImportHelp.module.css";

export default function PortfolioImportHelp() {
  const [copied, setCopied] = useState(false), [copyError, setCopyError] = useState("");
  async function copy() {
    setCopyError(""); setCopied(false);
    try { await navigator.clipboard.writeText(portfolioAiInstructions); setCopied(true); }
    catch { setCopyError("Clipboard access is unavailable. Select and copy the instructions below."); }
  }
  return <details className={styles.help}>
    <summary>CSV format & export help</summary>
    <div className={styles.body}>
      <p>Create a CSV manually from your broker or spreadsheet, or copy the instructions below into your preferred AI tool.</p>
      <div className={styles.actions}>
        <Button kind="secondary" onClick={() => void copy()}><Copy size={16} />{copied ? "Instructions copied" : "Copy AI instructions"}</Button>
      </div>
      {(copied || copyError) && <p className={styles.note} role="status">{copyError || "Copied. Paste the instructions and your actual holdings into your AI tool."}</p>}
      <h4>Export it yourself</h4>
      <ol><li>Export your current holdings from your broker, or copy them into a spreadsheet.</li><li>Use the column names below. Keep one row per position; remove totals and notes.</li><li>Save as CSV (UTF-8), then upload it here and review the parsed values before confirming.</li></ol>
      <div className={styles.tableScroll}><table><caption>Portfolio CSV columns</caption><thead><tr><th>Column</th><th>Required</th><th>Example / rule</th></tr></thead><tbody>{portfolioColumns.map(column => <tr key={column.name}><td><code>{column.name}</code></td><td>{column.required ? "Yes" : "Optional"}</td><td><code>{column.example}</code><p>{column.rule}</p></td></tr>)}</tbody></table></div>
      <p>Recognized broker aliases include ticker or symbol, and market-value headers such as Total Market Value. The canonical names above are recommended when creating a new file.</p>
      <details className={styles.example}><summary>View an illustrative CSV</summary><pre>{portfolioExample}</pre><p>Example values only. Replace them with your actual holdings.</p></details>
      <h4>Prepare it with your AI tool</h4>
      <p>Paste these instructions and your holdings into your AI tool. Save the returned CSV and review it before uploading. Green Street does not send your holdings to an AI service.</p>
      <textarea aria-label="AI export instructions" readOnly value={portfolioAiInstructions} rows={8} onFocus={e => e.currentTarget.select()} />
    </div>
  </details>;
}
