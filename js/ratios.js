// 재무비율 계산. 입력은 /api/financials 응답, 출력은 { ratioKey: { year: value } }.
// 수익성 비율(ROE·ROA·회전율)은 전년도가 있으면 평균잔액, 없으면 기말잔액을 분모로 쓴다.

export const RATIOS = [
  { key: "revenueGrowth", label: "매출액 증가율", group: "성장성", unit: "%", better: "high" },
  { key: "opIncomeGrowth", label: "영업이익 증가율", group: "성장성", unit: "%", better: "high" },
  { key: "grossMargin", label: "매출총이익률", group: "수익성", unit: "%", better: "high" },
  { key: "opMargin", label: "영업이익률", group: "수익성", unit: "%", better: "high" },
  { key: "netMargin", label: "순이익률", group: "수익성", unit: "%", better: "high" },
  { key: "roe", label: "ROE (자기자본이익률)", group: "수익성", unit: "%", better: "high" },
  { key: "roa", label: "ROA (총자산이익률)", group: "수익성", unit: "%", better: "high" },
  { key: "debtRatio", label: "부채비율", group: "안정성", unit: "%", better: "low" },
  { key: "currentRatio", label: "유동비율", group: "안정성", unit: "%", better: "high" },
  { key: "equityRatio", label: "자기자본비율", group: "안정성", unit: "%", better: "high" },
  { key: "assetTurnover", label: "총자산회전율", group: "활동성", unit: "회", better: "high" },
  { key: "fcf", label: "잉여현금흐름 (FCF)", group: "현금흐름", unit: "억원", better: "high" },
];

const div = (a, b) => (a == null || b == null || b === 0 ? null : a / b);
const pct = (a, b) => { const v = div(a, b); return v == null ? null : v * 100; };
const growth = (cur, prev) => (cur == null || prev == null || prev <= 0 ? null : ((cur - prev) / prev) * 100);
const avg = (cur, prev) => (cur == null ? null : prev == null ? cur : (cur + prev) / 2);

export function computeRatios(fin) {
  const d = fin.data;
  const out = Object.fromEntries(RATIOS.map((r) => [r.key, {}]));
  for (const y of fin.years) {
    const p = y - 1;
    const v = (k, yr = y) => d[k]?.[yr] ?? null;
    const gross = v("grossProfit") ?? (v("revenue") != null && v("costOfSales") != null ? v("revenue") - v("costOfSales") : null);
    // 연결재무제표면 지배주주 순이익/자본으로 ROE를 계산
    const ni = v("netIncomeOwners") ?? v("netIncome");
    const eq = (yr) => v("equityOwners", yr) ?? v("totalEquity", yr);

    out.revenueGrowth[y] = growth(v("revenue"), v("revenue", p));
    out.opIncomeGrowth[y] = growth(v("operatingIncome"), v("operatingIncome", p));
    out.grossMargin[y] = pct(gross, v("revenue"));
    out.opMargin[y] = pct(v("operatingIncome"), v("revenue"));
    out.netMargin[y] = pct(v("netIncome"), v("revenue"));
    out.roe[y] = pct(ni, avg(eq(y), eq(p)));
    out.roa[y] = pct(v("netIncome"), avg(v("totalAssets"), v("totalAssets", p)));
    out.debtRatio[y] = pct(v("totalLiabilities"), v("totalEquity"));
    out.currentRatio[y] = pct(v("currentAssets"), v("currentLiabilities"));
    out.equityRatio[y] = pct(v("totalEquity"), v("totalAssets"));
    out.assetTurnover[y] = div(v("revenue"), avg(v("totalAssets"), v("totalAssets", p)));
    // 유형자산 취득은 현금흐름표에 음수(유출)로도, 양수로도 기재되므로 절댓값을 뺀다
    out.fcf[y] = v("operatingCashFlow") == null || v("capex") == null ? null : (v("operatingCashFlow") - Math.abs(v("capex"))) / 1e8;
  }
  return out;
}

export function formatRatio(value, unit) {
  if (value == null || !Number.isFinite(value)) return "–";
  if (unit === "%") return `${value.toFixed(1)}%`;
  if (unit === "회") return `${value.toFixed(2)}회`;
  if (unit === "억원") return `${Math.round(value).toLocaleString("ko-KR")}억`;
  return String(value);
}
