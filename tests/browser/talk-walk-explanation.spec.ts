import { test, expect, type Page } from '@playwright/test';
import type { TalkWalkData, TalkWalkFirm, EnvironmentalFirm } from '../../src/dataset';

const apiPaths = new WeakMap<Page, string[]>();
const firm = (talk: number | null, walk: number | null, gap: number | null, greenwasher: boolean | null, year = 2025): TalkWalkFirm => ({ firm_id: '0002.HK', year, talk, walk, gap, greenwasher, greenhusher: greenwasher == null ? null : false, source: 'Saved dictionary table' });
const environmental = (overrides: Partial<EnvironmentalFirm> = {}): EnvironmentalFirm => ({ firm_id: '0002.HK', year: 2025, e_score: 1.875, e_weight: 50, g: -4.0625, provider: 'walk_hard', sector: 'Utilities', intensity: null, scope1: null, scope2: null, revenue: null, rank: null, comparison_count: null, rank_group: null, source: 'Saved greenness table', default_hard_path: false, walk_matches_e_score: false, ...overrides });
function response(dictionary: TalkWalkFirm[] = [], semantic: TalkWalkFirm[] = []): TalkWalkData {
  return { dataset_id: 'builtin', market: 'all', limitations: [], environmental: { firms: [environmental()] },
    semantic_llm: { kind: 'semantic_llm', scale: '0–10 semantic rubric', firms: semantic, coverage: { firms: semantic.length, documents: 0 }, methodology: { classification: 'not_provided', gap_is_classifier: false } },
    dictionary: { kind: 'dictionary', scale: '0–10 within-sector percentile', firms: dictionary, methodology: { rule: 'high_talk_low_walk', talk_min: 8, walk_max: 10 / 3, gap_is_classifier: false, source: 'esgx.measures.greenwash', provenance: 'builtin_pipeline' } },
  };
}
const companies = [
  { id: 'clp', ticker: '0002.HK', name: 'CLP Holdings', sector: 'Utilities', score: 9, materiality: 30, carbon: null, assessment_status: 'insufficient_data' },
  { id: 'hsbc', ticker: '0005.HK', name: 'HSBC Holdings', sector: 'Financial Services', score: 8, materiality: 30, carbon: null, assessment_status: 'insufficient_data' },
];
function panel(page: Page, name: RegExp) { return page.locator('section').filter({ has: page.getByRole('heading', { name }) }); }
async function mockData(page: Page, data: TalkWalkData, second = response()) {
  const paths: string[] = []; apiPaths.set(page, paths);
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname; paths.push(path);
    const id = route.request().headers()['x-dataset-id'] || 'builtin';
    if (path === '/api/talk-walk') return route.fulfill({ json: { ...(url.searchParams.get('firm_id') === '0005.HK' || id !== 'builtin' ? second : data), dataset_id: id } });
    if (path === '/api/companies') return route.fulfill({ json: companies });
    if (path === '/api/data/status') return route.fulfill({ json: { dataset_id: id, mode: 'snapshot', label: 'Snapshot', is_latest: false, snapshot_date: '2026-08', markets: {}, missing_markets: [], limitations: [] } });
    if (path === '/api/portfolio/filters') return route.fulfill({ json: { sectors: [] } });
    if (path === '/api/data/mount') return route.fulfill({ json: { dataset_id: 'mounted-test' } });
    if (path === '/api/data/sources') return route.fulfill({ json: { dataset_id: id, sources: [], capabilities: {} } });
    await route.fulfill({ status: 404, json: { detail: 'Unexpected API request in evidence-only test' } });
  });
}
async function openScores(page: Page, data: TalkWalkData, second?: TalkWalkData) {
  await mockData(page, data, second); await page.goto('/app');
  await page.getByRole('button', { name: 'Talk & Walk', exact: true }).click();
  await page.getByRole('button', { name: /CLP Holdings/ }).click();
  const claims = panel(page, /Environmental claims & signal/); await expect(claims).toBeVisible(); return claims;
}
test.afterEach(async ({ page }) => { expect(apiPaths.get(page)?.filter(path => /recommend|optim|solve/.test(path)) ?? []).toEqual([]); });

for (const scenario of [
  { name: 'large gap with Talk below threshold', talk: 6, walk: 1, gap: 5, flag: false },
  { name: 'high Talk with Walk above threshold', talk: 9, walk: 5, gap: 4, flag: false },
  { name: 'high Talk AND weak Walk', talk: 9, walk: 2, gap: 7, flag: true },
]) {
  test(`dictionary preserves server classification: ${scenario.name}`, async ({ page }) => {
    const claims = await openScores(page, response([firm(scenario.talk, scenario.walk, scenario.gap, scenario.flag)]));
    await expect(claims.getByText(`+${scenario.gap.toFixed(2)}`, { exact: true })).toBeVisible();
    await expect(claims.getByRole('status')).toContainText(scenario.flag ? 'Greenwash signal detected' : 'No signal detected');
    await expect(claims.locator('details')).not.toHaveAttribute('open');
    await claims.getByText(/Signal rule & Talk calculation/).click();
    await expect(claims.locator('details')).toContainText('Talk ≥ 8 AND Walk ≤ 10/3 (≈3.33)');
    await expect(claims.locator('details')).toContainText('A large gap alone does not trigger');
  });
}
test('CLP hard metrics lead while LLM evidence has a separate scale and meaning', async ({ page }) => {
  const sem = { ...firm(6.5, 7.6, -1.1, null), documents: [{ period: '2025-12-31', filing_date: '2026-03-11', source_url: 'https://example.org/report.pdf', model: 'kimi-k3', summary: 'Report basis before semantic ratings.', evidence_talk: ['Net zero goal'], evidence_walk: ['Measured emissions change'] }], dimensions: { walk_governance: 7 } };
  await openScores(page, response([firm(6.5, 1.875, 4.625, false)], [sem]));
  const main = panel(page, /Environmental performance/), llm = panel(page, /Report evidence & LLM/);
  await expect(main.locator('article').getByText('1.88', { exact: true })).toBeVisible(); await expect(main.locator('article').getByText('50.00', { exact: true })).toBeVisible();
  await expect(main.locator('article').getByText('-4.0625', { exact: true })).toBeVisible(); await expect(llm.getByText('7.60 / 10', { exact: true })).toBeVisible();
  await expect(llm).toContainText('不参与当前 g 计算'); await expect(llm).toContainText('Published / filed · 2026-03-11 · kimi-k3');
  await expect(llm.getByRole('link', { name: /Open source document/ })).toHaveAttribute('href', 'https://example.org/report.pdf');
  await expect(llm.getByText('Measured emissions change', { exact: true })).toBeVisible();
  expect(await page.locator('section').evaluateAll(sections => sections.findIndex(s => s.textContent?.includes('主要环境指标')) < sections.findIndex(s => s.textContent?.includes('报告证据与辅助评价')))).toBeTruthy();
  const texts = await llm.locator('p').allTextContents(); expect(texts.findIndex(t => t.includes('Report basis'))).toBeLessThan(texts.findIndex(t => t.includes('Action evidence assessment')));
});
test('LLM scores meeting dictionary thresholds are never classified', async ({ page }) => {
  await openScores(page, response([firm(6, 1, 5, false)], [firm(9, 2, 7, true)]));
  const llm = panel(page, /Report evidence & LLM/); await expect(llm).toContainText('Dictionary rule does not classify LLM scores'); await expect(llm).not.toContainText('Greenwash signal detected');
});
test('rounded scores preserve backend flags and supplied rule provenance', async ({ page }) => {
  const data = response([firm(7.9999, 3.3334, 4.6665, false)]);
  data.dictionary.methodology = { ...data.dictionary.methodology!, talk_min: 9.1, walk_max: 1.25, provenance: 'dataset_supplied', source: 'Institutional export rule' };
  const claims = await openScores(page, data); await expect(claims.getByText('8.00', { exact: true })).toBeVisible(); await expect(claims.getByRole('status')).toContainText('No signal detected');
  await claims.getByText(/Signal rule & Talk calculation/).click(); await expect(claims).toContainText('Talk ≥ 9.1 AND Walk ≤ 1.25'); await expect(claims).toContainText('Institutional export rule');
});
test('reference methodology never claims an active dataset rule', async ({ page }) => {
  const data = response([firm(2, 9, -7, null)]); data.dictionary.methodology!.provenance = 'reference_only';
  const claims = await openScores(page, data); await expect(claims.getByText('-7.00', { exact: true })).toBeVisible(); await expect(claims.getByRole('status')).toContainText('Insufficient data');
  await claims.getByText(/Signal rule & Talk calculation/).click(); await expect(claims).toContainText('Reference rule · 参考规则'); await expect(claims.getByText('Dataset rule · 当前数据集规则', { exact: true })).toHaveCount(0);
});
test('missing scores are insufficient even when flags exist', async ({ page }) => {
  const claims = await openScores(page, response([firm(9, null, null, true)])); await expect(claims.getByRole('status')).toContainText('Insufficient data'); await expect(claims).not.toContainText('Greenwash signal detected'); await expect(page.getByText(/No stored LLM assessment is available/)).toBeVisible();
});
test('years are independent and sparse records do not substitute other years', async ({ page }) => {
  const data = response([firm(6, 1, 5, false, 2024)], [firm(6, 7.6, -1.6, null, 2025)]); data.environmental!.firms = [environmental({ year: 2024 })];
  const claims = await openScores(page, data); await expect(page.getByText(/Years differ/)).toContainText('硬数据 2024 / LLM 报告 2025');
  await page.getByLabel('Hard-data year · 评分年份').selectOption('2025'); await expect(claims).toContainText('No dictionary assessment is available for this company in 2025'); await expect(claims).not.toContainText('No signal detected');
  await expect(panel(page, /Environmental performance/)).toContainText('该年份未提供唯一的环境评分记录');
  await page.getByLabel('LLM report year · 报告年份').selectOption('2024'); await expect(panel(page, /Report evidence & LLM/)).toContainText('No stored LLM assessment is available for this company in 2024'); await expect(panel(page, /Report evidence & LLM/).getByText('7.60 / 10', { exact: true })).toHaveCount(0);
});
test('formula uses stored fields only and Walk equality requires confirmation', async ({ page }) => {
  const data = response(); data.environmental!.firms = [environmental({ e_weight: null, g: null })]; await openScores(page, data);
  const main = panel(page, /Environmental performance/); await expect(main).toContainText('当前记录未确认使用默认碳强度路径');
  await main.getByText(/01 · Emissions & revenue/).click(); await expect(main.locator('dl').first()).toContainText('当前数据未提供');
  await main.getByText(/03 · E-score/).click(); await expect(main).toContainText('其他大行业不会加入'); await expect(main).toContainText('组内只有 1 个有效值时给 5 分'); await expect(main.getByText('30.00', { exact: true })).toHaveCount(0);
});
test('confirmed default path can identify hard Walk as E-score', async ({ page }) => {
  const data = response(); data.environmental!.firms = [environmental({ default_hard_path: true, walk_matches_e_score: true })]; await openScores(page, data); await expect(page.getByText(/^硬数据 Walk = 当前 E-score/)).toBeVisible();
});
test('formula experiment changes direction without company mutations or API calls', async ({ page }) => {
  await openScores(page, response()); const main = panel(page, /Environmental performance/), before = await main.innerText();
  const output = page.getByLabel('Example raw g'); await expect(output).toContainText('-1.600'); const count = apiPaths.get(page)!.length;
  await page.getByLabel('Example E-score', { exact: true }).fill('8'); await expect(output).toContainText('-0.800');
  await page.getByLabel('Example E_weight', { exact: true }).fill('60'); await expect(output).toContainText('-1.200');
  await page.getByLabel('Example E-score', { exact: true }).fill('10'); await expect(output).toContainText('0.000');
  await page.getByLabel('Example E-score', { exact: true }).fill(''); await expect(output).toContainText('请输入有效范围');
  expect(await main.innerText()).toBe(before); expect(apiPaths.get(page)!.length).toBe(count);
});
test('company switch clears old evidence', async ({ page }) => {
  const first = response([firm(6, 1, 5, true)], [{ ...firm(6, 7, -1, null), documents: [{ summary: 'CLP exclusive evidence' }] }]); const second = response(); second.environmental!.firms = [];
  await openScores(page, first, second); await page.getByRole('button', { name: 'Change company' }).click(); await page.getByRole('button', { name: /HSBC Holdings/ }).click();
  await expect(page.getByText('CLP exclusive evidence', { exact: true })).toHaveCount(0); await expect(page.getByText(/Greenwash signal detected/)).toHaveCount(0); await expect(panel(page, /Environmental performance/)).toContainText('未提供唯一的环境评分记录');
});
test('reselecting the current company preserves loaded evidence', async ({ page }) => {
  await openScores(page, response([firm(6, 1, 5, false)]));
  await page.getByRole('button', { name: 'Change company' }).click();
  await page.getByRole('button', { name: /CLP Holdings/ }).click();
  await expect(panel(page, /Environmental performance/)).toBeVisible();
  await expect(page.getByText('Waiting for company data…')).toHaveCount(0);
});
test('dataset mount resets company and loads new dataset evidence', async ({ page }) => {
  await openScores(page, response([firm(9, 1, 8, true)])); await page.getByRole('button', { name: 'Data sources', exact: true }).first().click();
  await page.getByLabel('JSON dataset', { exact: true }).setInputFiles({ name: 'new.json', mimeType: 'application/json', buffer: Buffer.from('{}') }); await expect(page.getByRole('button', { name: 'Use built-in dataset' })).toBeVisible();
  await page.getByRole('button', { name: 'Talk & Walk', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Select a company' })).toBeVisible(); await expect(page.getByText(/Greenwash signal detected/)).toHaveCount(0);
  await page.getByRole('button', { name: /CLP Holdings/ }).click(); await expect(panel(page, /Environmental claims & signal/).getByRole('status')).toContainText('Insufficient data');
});
test('failed request exposes retry without prior scores', async ({ page }) => {
  await mockData(page, response()); await page.route('**/api/talk-walk?**', route => route.fulfill({ status: 503, json: { detail: 'Evidence unavailable for now' } })); await page.goto('/app');
  await page.getByRole('button', { name: 'Talk & Walk', exact: true }).click(); await page.getByRole('button', { name: /CLP Holdings/ }).click();
  await expect(page.getByRole('alert')).toContainText('Evidence unavailable'); await expect(page.getByRole('button', { name: 'Retry company evidence' })).toBeVisible(); await expect(panel(page, /Environmental performance/)).toHaveCount(0);
});
test('mobile formulas, links and keyboard disclosure remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const sem = { ...firm(6, 7.6, -1.6, null), documents: [{ source_url: 'https://example.org/reports/a-long-report-name-with-a-long-path.pdf', summary: 'Long report evidence', evidence_talk: ['Claim'], evidence_walk: ['Action'] }] };
  await openScores(page, response([firm(6, 1, 5, false)], [sem])); await page.getByLabel('Hard-data year · 评分年份').focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  await expect(panel(page, /Environmental performance/).locator('details').first()).toHaveAttribute('open'); await page.getByText(/03 · E-score/).click(); await page.getByText(/05 · Company g/).click();
  await expect(page.getByRole('link', { name: /Open source document/ })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy(); await page.screenshot({ path: 'output/playwright/talkwalk-learning-test-mobile.png', fullPage: true });
});
