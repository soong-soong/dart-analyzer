// 강의 4~6장 분석: 손익 브리지, 현금흐름(FCF 창출·배분), ROE 분해(ROIC·재무레버리지), 듀퐁, 이익의 질 경보
import { helpers, div, pct, growth, sum } from "./core.js";

const EOK = 1e8;

/** 영업이익 → 순이익 → 지배주주 순이익 (강의 5장: 영업 밖에서 생긴 손익 찾기) */
export function bridge(fin, y) {
  const { v, taxRate } = helpers(fin);
  const oi = v("operatingIncome", y);
  if (oi == null) return null;
  const steps = [
    ["기타수익", v("otherIncome", y)],
    ["기타비용", v("otherExpense", y) == null ? null : -v("otherExpense", y)],
    ["금융수익", v("financeIncome", y)],
    ["금융비용", v("financeCosts", y) == null ? null : -v("financeCosts", y)],
    ["지분법손익", v("equityMethod", y)],
  ].filter(([, x]) => x != null && x !== 0);

  const items = [{ label: "영업이익", value: oi, total: true }];
  let run = oi;
  for (const [label, value] of steps) { items.push({ label, value }); run += value; }
  const pretax = v("pretaxIncome", y);
  if (pretax != null) {
    if (Math.abs(pretax - run) >= 0.5 * EOK) items.push({ label: "기타 차이", value: pretax - run });
    items.push({ label: "세전이익", value: pretax, total: true });
    run = pretax;
  }
  const tax = v("incomeTax", y);
  if (tax) { items.push({ label: "법인세", value: -tax }); run -= tax; }
  const disc = v("discontinued", y);
  if (disc) { items.push({ label: "중단영업손익", value: disc }); run += disc; }
  const ni = v("netIncome", y);
  if (ni != null) {
    if (Math.abs(ni - run) >= 0.5 * EOK) items.push({ label: "기타 차이", value: ni - run });
    items.push({ label: "당기순이익", value: ni, total: true });
  }
  const owners = v("netIncomeOwners", y);
  if (owners != null && ni != null && Math.abs(ni - owners) >= 0.5 * EOK) {
    items.push({ label: "비지배지분 몫", value: owners - ni });
    items.push({ label: "지배주주 순이익", value: owners, total: true });
  }

  // 5장 근사: 기타수익·기타비용을 모두 일시적 손익으로 보고 세후로 되돌린 순이익
  const otherNet = (v("otherIncome", y) ?? 0) - (v("otherExpense", y) ?? 0);
  const coreNi = ni == null ? null : ni - otherNet * (1 - taxRate(y));
  const eps = v("eps", y);
  return {
    items, oi, ni, owners, eps, otherNet, coreNi,
    operatingProfitButNetLoss: oi > 0 && (owners ?? ni) < 0,
  };
}

/** 강의 6장 현금흐름 분석. 금액은 원 단위 */
export function cashFlow(fin, y) {
  const { v, taxRate } = helpers(fin);
  const ocf = v("operatingCashFlow", y);
  if (ocf == null) return null;
  const t = taxRate(y);
  const netCapex = (v("capex", y) ?? 0) + (v("capexIntangible", y) ?? 0) - (v("ppeDisposal", y) ?? 0);
  const paidOp = v("interestPaidOp", y) ?? 0;
  const paidFin = v("interestPaidFin", y) ?? 0;
  const recvOp = v("interestReceivedOp", y) ?? 0;
  const interestClass = paidOp && !paidFin ? "영업활동" : paidFin && !paidOp ? "재무활동" : paidOp && paidFin ? "혼합" : "–";

  // 기업이 창출한 FCF: 영업현금흐름에서 이자 효과를 걷어내(재무활동으로 통일) 회사 간 분류 차이를 없앤다
  const ocfCore = ocf + (paidOp - recvOp) * (1 - t);
  const fcfSimple = ocf - netCapex;
  const fcfFirm = ocfCore - netCapex;
  const lease = v("leaseRepayment", y) ?? 0;

  // 창출된 FCF의 배분 (재무활동)
  const netInterest = (paidOp + paidFin - recvOp) * (1 - t);
  const netDebtRepay = (v("debtRepaid", y) ?? 0) - (v("debtIssued", y) ?? 0) - (v("debtNetChange", y) ?? 0);
  const dividends = v("dividendsPaid", y) ?? 0;
  const buyback = v("treasuryShares", y) ?? 0;
  const uses = [
    ["이자(세후)", netInterest],
    ["리스료(리스부채 상환)", lease],
    [netDebtRepay >= 0 ? "차입금 순상환" : "차입금 순증가(조달)", netDebtRepay],
    ["배당금", dividends],
    ["자기주식 취득", buyback],
  ];
  const used = uses.reduce((s, [, x]) => s + x, 0);
  return {
    ocf, ocfCore, netCapex, fcfSimple, fcfFirm, fcfAfterLease: fcfFirm - lease, lease,
    interestClass, interestPaid: paidOp + paidFin, uses, rest: fcfFirm - used,
    investing: v("investingCashFlow", y), financing: v("financingCashFlow", y),
    ni: v("netIncome", y),
  };
}

/** 강의 4장 발전된 분석: ROE = ROIC + (ROIC − 세후순차입이자율) × 순재무부채/자기자본 (연결실체 기준) */
export function roeTree(fin, y, basis) {
  const { v, bal, taxRate } = helpers(fin, basis);
  const t = taxRate(y);
  const ni = v("netIncome", y);
  const rev = v("revenue", y);
  if (ni == null) return null;
  const nfe = ((v("financeCosts", y) ?? 0) - (v("financeIncome", y) ?? 0)) * (1 - t); // 세후 순금융비용
  const nopat = ni + nfe; // 세후 순영업이익
  // 금융비용에 리스 이자가 들어 있으므로 재무부채에도 리스부채를 포함해 분자·분모를 맞춘다
  const nfdAt = (yy) => {
    const debt = sum(v("borrowings", yy), v("leaseLiabilities", yy));
    return debt == null ? null : debt - (v("financialAssets", yy) ?? 0);
  };
  const nfd = (() => {
    const cur = nfdAt(y), prev = fin.years.includes(y - 1) ? nfdAt(y - 1) : null;
    if (basis === "end") return cur;
    if (basis === "begin") return prev;
    return cur == null ? null : prev == null ? cur : (cur + prev) / 2;
  })();
  const equity = bal("totalEquity", y);
  if (nfd == null || equity == null || equity <= 0) return null;
  const ic = nfd + equity; // 영업투하자본
  const roic = div(nopat, ic);
  const r = div(nfe, nfd);
  const lev = div(nfd, equity);
  const effect = roic == null || r == null || lev == null ? null : (roic - r) * lev;
  return {
    t, nopat, nfe, nfd, equity, ic,
    roe: div(ni, equity) * 100,
    roic: roic == null ? null : roic * 100,
    r: r == null ? null : r * 100,
    lev,
    effect: effect == null ? null : effect * 100,
    nopatMargin: pct(nopat, rev),
    icTurnover: div(rev, ic),
    netCash: nfd < 0,
  };
}

/** 듀퐁: ROA = 매출액순이익률 × 총자산회전율 */
export function dupont(fin, y, basis) {
  const { v, bal } = helpers(fin, basis);
  const margin = pct(v("netIncome", y), v("revenue", y));
  const turnover = div(v("revenue", y), bal("totalAssets", y));
  return { margin, turnover, roa: margin == null || turnover == null ? null : margin * turnover };
}

/** 이익의 질·재무 경보 (강의 2장 이익조정, 3장 운전자본) */
export function flags(fin, y) {
  const { v } = helpers(fin);
  const out = [];
  const p = y - 1;
  const oi = v("operatingIncome", y), owners = v("netIncomeOwners", y) ?? v("netIncome", y);
  const ni = v("netIncome", y), ocf = v("operatingCashFlow", y);
  if (oi > 0 && owners < 0) out.push({ level: "warn", text: "영업이익은 흑자인데 순이익은 적자 → '손익 브리지' 탭에서 원인 확인" });
  const eps = v("eps", y);
  if (eps != null && eps < 0) out.push({ level: "warn", text: `주당순이익(EPS) ${eps.toLocaleString("ko-KR")}원으로 음수 → PER 산출 불가(N/A)` });
  if (ni != null && ocf != null && v("netIncome", p) != null && v("operatingCashFlow", p) != null && ni > v("netIncome", p) && ocf < v("operatingCashFlow", p)) {
    out.push({ level: "warn", text: "순이익은 늘었는데 영업현금흐름은 줄어듦 (이익의 질 점검)" });
  }
  if (ni > 0 && ocf != null && ocf < ni) out.push({ level: "info", text: "영업현금흐름이 순이익보다 작음 (발생액이 큼)" });
  const revG = growth(v("revenue", y), v("revenue", p));
  const invG = growth(v("inventories", y), v("inventories", p));
  const arG = growth(v("receivables", y), v("receivables", p));
  if (revG != null && invG != null && invG - revG > 10) out.push({ level: "warn", text: `재고자산 증가율(${invG.toFixed(0)}%)이 매출 증가율(${revG.toFixed(0)}%)보다 10%p 이상 높음` });
  if (revG != null && arG != null && arG - revG > 10) out.push({ level: "warn", text: `매출채권 증가율(${arG.toFixed(0)}%)이 매출 증가율(${revG.toFixed(0)}%)보다 10%p 이상 높음` });
  const wc = sum(v("receivables", y), v("inventories", y)) - (v("payables", y) ?? 0);
  if (v("payables", y) != null && wc < 0) out.push({ level: "info", text: "영업운전자본(매출채권+재고−매입채무)이 음수 → 회전율·현금전환주기 해석 주의" });
  return out;
}
