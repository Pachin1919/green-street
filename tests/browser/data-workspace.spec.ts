import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const company = (ticker: string, name: string) => ({ id: ticker, ticker, name, sector: 'Utilities', industry: 'Utilities', score: 6, weight: 20, g: -80, carbon: 0, talk: null, walk: null, greenwasher: null, greenhusher: null, assessment_status: 'insufficient_data', notes: '', listing_market: ticker.endsWith('.HK') ? 'hk' : 'tw' });
const companies = [company('0002.HK', 'CLP Holdings'), company('2330.TW', 'Taiwan Semiconductor')];
const observed = { start: '2020-01', end: '2026-08' };
async function mockData(page: Page, mode = 'snapshot') {
  const requests: { path: string; dataset: string; market: string | null }[] = [];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    const dataset = route.request().headers()['x-dataset-id'] || 'builtin';
    requests.push({ path, dataset, market: url.searchParams.get('market') });
    let data: unknown;
    if (path === '/api/data/status') data = { dataset_id: dataset, mode, label: mode, is_latest: false, snapshot_date: mode === 'snapshot' ? '2026-08' : null, markets: { hk: { status: mode, company_count: 1, data_dates: observed, sources: [] }, tw: { status: mode, company_count: 1, data_dates: observed, sources: [] } }, missing_markets: [], limitations: [] };
    else if (path === '/api/companies') data = companies.filter(c => !['hk', 'tw'].includes(url.searchParams.get('market') || '') || c.listing_market === url.searchParams.get('market'));
    else if (path === '/api/portfolio/filters') data = { sectors: [] };
    else if (path === '/api/data/sources') data = { dataset_id: dataset, sources: [], capabilities: { bundle_import: true, native_api_connector: false, native_sql_connector: false } };
    else if (path === '/api/data/mount') data = { dataset_id: 'snapshot-test' };
    else if (path === '/api/data/fx') data = { dataset_id: dataset, rates: [{ pair: 'USDHKD', rate: 7.8, date: '2026-08-31', source: 'Test reference snapshot', is_latest: false }], is_latest: false };
    else if (path === '/api/talk-walk') data = { dataset_id: dataset, market: 'hk', semantic_llm: { kind: 'semantic_llm', scale: '0–10 semantic rubric', firms: [], coverage: { firms: 0, documents: 0 } }, dictionary: { kind: 'dictionary', scale: '0–10 percentile', firms: [] }, limitations: [] };
    else if (path === '/api/portfolio/recommend') return route.fulfill({ status: 503, json: { detail: 'Insufficient model history in test snapshot' } });
    else data = {};
    await route.fulfill({ json: data });
  });
  return requests;
}

test('dated database is amber and market selection filters Talk & Walk', async ({ page }) => {
  const requests = await mockData(page);
  await page.goto('/app');
  await expect(page.getByText('Latest database data · 2026-08', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('status', { name: 'Database status' })).toContainText('Freshness unverified');
  await expect(page.getByRole('status', { name: 'Database status' }).locator('..')).toHaveCSS('background-color', 'rgb(255, 250, 235)');
  await page.getByRole('button', { name: 'Talk & Walk', exact: true }).click();
  await page.getByLabel('Listing market').selectOption('tw');
  await expect(page.getByRole('button', { name: /Taiwan Semiconductor/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /CLP Holdings/ })).toHaveCount(0);
  expect(requests.some(r => r.path === '/api/companies' && r.market === 'tw')).toBeTruthy();
});

test('unavailable database is red and a verified current feed is green', async ({ page }) => {
  await mockData(page, 'missing');
  await page.goto('/app');
  const bar = page.getByRole('status', { name: 'Database status' });
  await expect(bar).toContainText('Database data unavailable');
  await expect(bar.locator('..')).toHaveCSS('background-color', 'rgb(255, 247, 247)');
  await page.route('**/api/data/status?**', route => route.fulfill({ json: { dataset_id: 'builtin', mode: 'live', is_latest: true, snapshot_date: '2026-10-13', markets: {}, missing_markets: [], limitations: [] } }));
  await page.reload();
  await expect(bar).toContainText('Live database · 2026-10-13');
  await expect(bar.locator('..')).toHaveCSS('background-color', 'rgb(241, 248, 244)');
});

test('request failure is red while loading remains neutral', async ({ page }) => {
  await mockData(page);
  let finish: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/data/status?**', async route => { await pending; await route.fulfill({ status: 503, json: { detail: 'Database temporarily unavailable' } }); });
  await page.goto('/app');
  const bar = page.getByRole('status', { name: 'Database status' });
  await expect(bar).toContainText('Checking database data');
  await expect(bar.locator('..')).toHaveCSS('background-color', 'rgb(246, 248, 250)');
  finish!();
  await expect(bar).toContainText('Database temporarily unavailable');
  await expect(bar.locator('..')).toHaveCSS('background-color', 'rgb(255, 247, 247)');
});

test('portfolio help offers one parser-compatible CSV template', async ({ page }) => {
  await mockData(page);
  await page.goto('/app');
  await page.getByRole('button', { name: 'Upload portfolio', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const help = dialog.locator('details').filter({ has: page.getByText('CSV format & export help', { exact: true }) });
  await expect(help).not.toHaveAttribute('open');
  await page.getByText('CSV format & export help', { exact: true }).click();
  await expect(dialog.getByRole('row', { name: /current_holding_value/ })).toContainText('Not cost basis or allocation percentage');
  await expect(dialog.getByRole('button', { name: /schema/i })).toHaveCount(0);
  const csvDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV template', exact: true }).click();
  const csv = await csvDownload;
  // Preserve the downloaded filename when creating the upload payload.
  await page.getByLabel('Portfolio CSV').setInputFiles({ name: csv.suggestedFilename(), mimeType: 'text/csv', buffer: await readFile((await csv.path())!) });
  await expect(dialog.getByText(/2 holdings/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm upload' })).toBeEnabled();
});

test('AI instructions copy the complete contract and offer manual fallback', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as unknown as { copiedInstructions: string }).copiedInstructions = text; } } }); });
  await mockData(page);
  await page.goto('/app');
  await page.getByRole('button', { name: 'Upload portfolio', exact: true }).click();
  await page.getByText('CSV format & export help', { exact: true }).click();
  await page.getByRole('button', { name: 'Copy AI instructions', exact: true }).click();
  const text = await page.getByLabel('AI export instructions').inputValue();
  expect(text).toContain('Never invent');
  expect(text).toContain('Do not perform FX conversion');
  expect(await page.evaluate(() => (window as unknown as { copiedInstructions: string }).copiedInstructions)).toBe(text);
  await expect(page.getByRole('button', { name: 'Instructions copied' })).toBeVisible();
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Permission denied'); } } }); });
  await page.getByRole('button', { name: 'Instructions copied' }).click();
  await expect(page.getByText(/Select and copy the instructions below/)).toBeVisible();
});

test('expanded upload help works with keyboard at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockData(page);
  await page.goto('/app');
  await page.getByRole('button', { name: 'Upload portfolio', exact: true }).click();
  const summary = page.getByText('CSV format & export help', { exact: true });
  await summary.focus(); await page.keyboard.press('Enter');
  await expect(page.getByLabel('AI export instructions')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  const dialog = page.getByRole('dialog');
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();
  expect(await dialog.innerText()).not.toMatch(/[\u3400-\u9fff]/);
  await page.getByLabel('AI export instructions').focus();
  await expect(page.getByLabel('AI export instructions')).toBeFocused();
  await page.screenshot({ path: 'output/playwright/portfolio-import-help-mobile.png' });
});

test('missing semantic and dictionary evidence stays Insufficient data', async ({ page }) => {
  await mockData(page);
  await page.goto('/app');
  await page.getByRole('button', { name: 'Talk & Walk', exact: true }).click();
  await page.getByRole('button', { name: /CLP Holdings/ }).click();
  await expect(page.getByText('Insufficient data · No stored LLM assessment is available', { exact: false })).toBeVisible();
  await expect(page.getByText('Insufficient data · No dictionary assessment', { exact: false })).toBeVisible();
  await expect(page.getByText('No signal detected', { exact: true })).toHaveCount(0);
});

test('JSON mount selects its dataset for subsequent requests; invalid JSON does not activate', async ({ page }) => {
  const requests = await mockData(page);
  await page.goto('/app');
  await page.getByRole('button', { name: 'Data sources', exact: true }).first().click();
  await page.getByLabel('JSON dataset', { exact: true }).setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{bad') });
  await expect(page.getByRole('alert')).toContainText('not valid JSON');
  expect(requests.some(r => r.path === '/api/data/mount')).toBeFalsy();
  await page.getByLabel('JSON dataset', { exact: true }).setInputFiles({ name: 'valid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ metadata: {}, tables: {} })) });
  await expect(page.getByRole('button', { name: 'Use built-in dataset' })).toBeVisible();
  await expect.poll(() => requests.some(r => r.path === '/api/companies' && r.dataset === 'snapshot-test')).toBeTruthy();
  await page.getByRole('button', { name: 'Use built-in dataset' }).click();
  await expect(page.getByRole('button', { name: 'Use built-in dataset' })).toHaveCount(0);
});

test('CSV conversion shows rate provenance and blocks unsupported currency', async ({ page }) => {
  await mockData(page);
  await page.goto('/app');
  await page.getByRole('button', { name: 'Upload portfolio', exact: true }).click();
  const input = page.getByLabel('Portfolio CSV');
  await input.setInputFiles({ name: 'usd.csv', mimeType: 'text/csv', buffer: Buffer.from('ticker,current_holding_value,currency\n0002.HK,100,USD') });
  await expect(page.getByText('2026-08-31 · Test reference snapshot')).toBeVisible();
  await expect(page.getByText('7.800000 HKD')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm upload' })).toBeEnabled();
  await input.setInputFiles({ name: 'eur.csv', mimeType: 'text/csv', buffer: Buffer.from('ticker,current_holding_value,currency\n0002.HK,100,EUR') });
  await expect(page.getByRole('button', { name: 'Confirm upload' })).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText(/EUR/);
});

test('mobile keeps status, navigation and data controls inside viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockData(page, 'demo');
  await page.goto('/app');
  await expect(page.getByText(/Demo data · Illustrative/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Data sources', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Upload JSON dataset' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
});

test('landing example is explicitly illustrative', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/Illustrative/i).first()).toBeVisible();
});

test('failed analysis remains inspectable in a dismissible drawer, without invented results', async ({ page }) => {
  await mockData(page);
  await page.goto('/app?v=blue');
  await page.getByRole('button', { name: 'Recommendations', exact: true }).click();
  const trigger = page.getByRole('button', { name: 'Analysis details', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Analysis details' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Insufficient model history in test snapshot');
  await expect(dialog.getByRole('img', { name: /current .* recommended/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Close analysis details' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
