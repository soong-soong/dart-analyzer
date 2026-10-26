// 재무비율 (강의 3장). 입력은 /api/financials 응답, 출력은 { ratioKey: { year: value } }.
// 재무상태표 잔액이 분모인 비율은 basis(평균/기말/기초)를 따른다.
import { helpers, div, pct, growth, sum } from "./core.js";
import { cashFlow } from "./analysis.js";

// formula: 비율 이름에 마우스를 올리면 보이는 계산식 ("식이 왜 만들어졌는지 알아야")
export const RATIOS = [
  { key: "revenueGrowth", label: "매출액 증가율", group: "성장성", unit: "%", better: "high", formula: "(당기 매출액 − 전기 매출액) ÷ 전기 매출액" },
  { key: "opIncomeGrowth", label: "영업이익 증가율", group: "성장성", unit: "%", better: "high", formula: "(당기 영업이익 − 전기) ÷ 전기 (전기 적자면 표시 안 함)" },
  { key: "assetGrowth", label: "총자산 증가율", group: "성장성", unit: "%", better: "high", formula: "(당기말 총자산 − 전기말) ÷ 전기말" },

  { key: "grossMargin", label: "매출총이익률", group: "수익성", unit: "%", better: "high", formula: "매출총이익 ÷ 매출액" },
  { key: "sgaRatio", label: "판관비율", group: "수익성", unit: "%", better: "low", formula: "판매비와관리비 ÷ 매출액" },
  { key: "opMargin", label: "영업이익률", group: "수익성", unit: "%", better: "high", formula: "영업이익 ÷ 매출액" },
  { key: "netMargin", label: "순이익률", group: "수익성", unit: "%", better: "high", formula: "당기순이익 ÷ 매출액" },
  { key: "roe", label: "ROE (지배기업)", group: "수익성", unit: "%", better: "high", formula: "지배주주 순이익 ÷ 지배주주 자본 (연결이 아니면 순이익 ÷ 자본)" },
  { key: "roeTotal", label: "ROE (연결실체)", group: "수익성", unit: "%", better: "high", formula: "당기순이익 ÷ 자본총계(비지배지분 포함)" },
  { key: "roa", label: "ROA (총자산순이익률)", group: "수익성", unit: "%", better: "high", formula: "당기순이익 ÷ 총자산" },
  { key: "roaOp", label: "총자산순영업이익률", group: "수익성", unit: "%", better: "high", formula: "(당기순이익 + 이자비용×(1−세율)) ÷ 총자산 · 이자비용은 현금흐름표 이자지급액으로 근사" },

  { key: "assetTurnover", label: "총자산회전율", group: "활동성", unit: "회", better: "high", formula: "매출액 ÷ 총자산" },
  { key: "ppeTurnover", label: "유형자산회전율", group: "활동성", unit: "회", better: "high", formula: "매출액 ÷ 유형자산" },
  { key: "invDays", label: "재고 보유기간", group: "활동성", unit: "일", better: "low", formula: "재고자산 ÷ 매출원가 × 365" },
  { key: "arDays", label: "매출채권 회수기간", group: "활동성", unit: "일", better: "low", formula: "매출채권및기타채권 ÷ 매출액 × 365" },
  { key: "apDays", label: "매입채무 결제기간", group: "활동성", unit: "일", better: "high", formula: "매입채무및기타채무 ÷ 매출원가 × 365 (매입액 대신 매출원가로 근사)" },
  { key: "ccc", label: "현금전환주기", group: "활동성", unit: "일", better: "low", formula: "재고 보유기간 + 매출채권 회수기간 − 매입채무 결제기간" },

  { key: "currentRatio", label: "유동비율", group: "안정성", unit: "%", better: "high", formula: "유동자산 ÷ 유동부채 (기말)" },
  { key: "quickRatio", label: "당좌비율", group: "안정성", unit: "%", better: "high", formula: "(유동자산 − 재고자산) ÷ 유동부채 (기말)" },
  { key: "cashRatio", label: "현금비율", group: "안정성", unit: "%", better: "high", formula: "현금및현금성자산 ÷ 유동부채 (기말)" },
  { key: "debtRatio", label: "부채비율", group: "안정성", unit: "%", better: "low", formula: "부채총계 ÷ 자본총계 (기말)" },
  { key: "equityRatio", label: "자기자본비율", group: "안정성", unit: "%", better: "high", formula: "자본총계 ÷ 자산총계 (기말)" },
  { key: "borrowingRatio", label: "차입부채비율", group: "안정성", unit: "%", better: "low", formula: "(차입금 + 사채) ÷ 자본총계 (기말, 리스부채 제외)" },
  { key: "borrowingLeaseRatio", label: "차입부채비율 (리스 포함)", group: "안정성", unit: "%", better: "low", formula: "(차입금 + 사채 + 리스부채) ÷ 자본총계 (기말) · 매장 임차가 많은 유통업은 차이가 큼" },
  { key: "interestCoverage", label: "이자보상비율", group: "안정성", unit: "배", better: "high", formula: "영업이익 ÷ 금융비용 (금융비용에는 이자 외 환손실 등도 포함)" },
  { key: "cashInterestCoverage", label: "현금기준 이자보상비율", group: "안정성", unit: "배", better: "high", formula: "(영업활동현금흐름 + 이자지급 + 법인세납부) ÷ 이자지급" },

  { key: "ocfToNi", label: "영업현금흐름 ÷ 순이익", group: "현금흐름", unit: "배", better: "high", formula: "영업활동현금흐름 ÷ 당기순이익 (1배 미만이면 이익 대비 현금이 적음)" },
  { key: "fcf", label: "기업 FCF", group: "현금흐름", unit: "억원", better: "high", formula: "영업현금흐름(이자 효과 제거) − (유·무형자산 취득 − 유형자산 처분)" },
  { key: "fcfAfterLease", label: "FCF (리스료 차감)", group: "현금흐름", unit: "억원", better: "high", formula: "기업 FCF − 리스부채 상환액" },
];

export function computeRatios(fin, basis = "avg") {
  const { v, bal, has, taxRate } = helpers(fin, basis);
  const out = Object.fromEntries(RATIOS.map((r) => [r.key, {}]));
  for (const y of fin.years) {
    const p = y - 1;
    const prev = (k) => (has(p) ? v(k, p) : null);
    const gross = v("grossProfit", y) ?? (v("revenue", y) != null && v("costOfSales", y) != null ? v("revenue", y) - v("costOfSales", y) : null);
    const isConsolidated = fin.fs_div === "CFS" && v("netIncomeOwners", y) != null;
    const roeNi = isConsolidated ? v("netIncomeOwners", y) : v("netIncome", y);
    const roeEq = isConsolidated && bal("equityOwners", y) != null ? bal("equityOwners", y) : bal("totalEquity", y);
    const interest = sum(v("interestPaidOp", y), v("interestPaidFin", y));

    out.revenueGrowth[y] = growth(v("revenue", y), prev("revenue"));
    out.opIncomeGrowth[y] = growth(v("operatingIncome", y), prev("operatingIncome"));
    out.assetGrowth[y] = growth(v("totalAssets", y), prev("totalAssets"));

    out.grossMargin[y] = pct(gross, v("revenue", y));
    out.sgaRatio[y] = pct(v("sga", y), v("revenue", y));
    out.opMargin[y] = pct(v("operatingIncome", y), v("revenue", y));
    out.netMargin[y] = pct(v("netIncome", y), v("revenue", y));
    out.roe[y] = pct(roeNi, roeEq);
    out.roeTotal[y] = pct(v("netIncome", y), bal("totalEquity", y));
    out.roa[y] = pct(v("netIncome", y), bal("totalAssets", y));
    out.roaOp[y] = v("netIncome", y) == null ? null : pct(v("netIncome", y) + (interest ?? 0) * (1 - taxRate(y)), bal("totalAssets", y));

    out.assetTurnover[y] = div(v("revenue", y), bal("totalAssets", y));
    out.ppeTurnover[y] = div(v("revenue", y), bal("ppe", y));
    const invDays = div(bal("inventories", y), v("costOfSales", y));
    const arDays = div(bal("receivables", y), v("revenue", y));
    const apDays = div(bal("payables", y), v("costOfSales", y));
    out.invDays[y] = invDays == null ? null : invDays * 365;
    out.arDays[y] = arDays == null ? null : arDays * 365;
    out.apDays[y] = apDays == null ? null : apDays * 365;
    out.ccc[y] = invDays == null || arDays == null || apDays == null ? null : (invDays + arDays - apDays) * 365;

    out.currentRatio[y] = pct(v("currentAssets", y), v("currentLiabilities", y));
    out.quickRatio[y] = v("currentAssets", y) == null ? null : pct(v("currentAssets", y) - (v("inventories", y) ?? 0), v("currentLiabilities", y));
    out.cashRatio[y] = pct(v("cash", y), v("currentLiabilities", y));
    out.debtRatio[y] = pct(v("totalLiabilities", y), v("totalEquity", y));
    out.equityRatio[y] = pct(v("totalEquity", y), v("totalAssets", y));
    out.borrowingRatio[y] = pct(v("borrowings", y), v("totalEquity", y));
    out.borrowingLeaseRatio[y] = pct(sum(v("borrowings", y), v("leaseLiabilities", y)), v("totalEquity", y));
    out.interestCoverage[y] = div(v("operatingIncome", y), v("financeCosts", y));
    out.cashInterestCoverage[y] = v("operatingCashFlow", y) == null || !interest ? null
      : (v("operatingCashFlow", y) + interest + Math.abs(v("taxesPaid", y) ?? 0)) / interest;

    const cf = cashFlow(fin, y);
    out.ocfToNi[y] = v("netIncome", y) > 0 ? div(v("operatingCashFlow", y), v("netIncome", y)) : null;
    out.fcf[y] = cf ? cf.fcfFirm / 1e8 : null;
    out.fcfAfterLease[y] = cf ? cf.fcfAfterLease / 1e8 : null;
  }
  return out;
}
