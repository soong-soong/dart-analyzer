// GET /api/financials?corp_code=00126380&year=2025&fs=CFS
// 사업보고서(11011) 단일회사 전체 재무제표를 받아 주요 계정을 연도별로 정리하고, 현금흐름표 전체 행도 함께 돌려준다.
// 보고서 1건에 당기·전기·전전기 3개년이 들어 있으므로, 2건을 동시에 조회해 최대 6개년을 만든다.
const { dart, isCorpCode, send, handleError, HttpError } = require("./_dart");

const ANNUAL_REPORT = "11011";
const IS = ["IS", "CIS"];

// key: 화면에서 쓰는 이름.
//   ids/prefixes(IFRS·DART 태그)를 먼저 찾고, 없으면 names(공백 제거한 계정명)로 찾는다.
//   sum: 조건에 맞는 행을 모두 더한다 (차입금처럼 회사마다 쪼개 적는 계정).
//   abs: 현금흐름표처럼 유출을 양수/음수로 제각각 적는 항목은 절댓값으로 통일한다.
const ACCOUNTS = {
  // 손익계산서
  revenue:          { sj: IS, ids: ["ifrs-full_Revenue"], names: ["매출액", "수익(매출액)", "영업수익", "매출", "매출및지분법손익"] },
  costOfSales:      { sj: IS, ids: ["ifrs-full_CostOfSales"], names: ["매출원가", "영업비용"] },
  grossProfit:      { sj: IS, ids: ["ifrs-full_GrossProfit"], names: ["매출총이익", "매출총이익(손실)"] },
  sga:              { sj: IS, ids: ["dart_TotalSellingGeneralAdministrativeExpenses"], names: ["판매비와관리비"] },
  operatingIncome:  { sj: IS, ids: ["dart_OperatingIncomeLoss"], names: ["영업이익", "영업이익(손실)", "영업손익"] },
  otherIncome:      { sj: IS, ids: ["dart_OtherGains"], names: ["기타수익", "기타영업외수익", "영업외수익"] },
  otherExpense:     { sj: IS, ids: ["dart_OtherLosses"], names: ["기타비용", "기타영업외비용", "영업외비용"] },
  // 금융수익을 "이자수익 / 기타"로 나눠 적는 회사(롯데쇼핑 등)가 있어 합산한다
  financeIncome:    { sj: IS, sum: true, ids: ["ifrs-full_FinanceIncome", "ifrs-full_OtherFinanceIncome", "ifrs-full_InterestRevenueCalculatedUsingEffectiveInterestMethod"], names: ["금융수익", "금융이익"], pattern: /^금융수익-/ },
  financeCosts:     { sj: IS, ids: ["ifrs-full_FinanceCosts"], names: ["금융비용", "금융원가"] },
  equityMethod:     { sj: IS, ids: ["ifrs-full_ShareOfProfitLossOfAssociatesAndJointVenturesAccountedForUsingEquityMethod"], names: ["지분법손익", "관계기업손익", "지분법투자이익(손실)", "관계기업및공동기업투자손익"] },
  pretaxIncome:     { sj: IS, ids: ["ifrs-full_ProfitLossBeforeTax"], names: ["법인세비용차감전순이익", "법인세차감전순이익", "법인세비용차감전순이익(손실)"] },
  incomeTax:        { sj: IS, ids: ["ifrs-full_IncomeTaxExpenseContinuingOperations"], names: ["법인세비용", "법인세비용(수익)"] },
  discontinued:     { sj: IS, ids: ["ifrs-full_ProfitLossFromDiscontinuedOperations"], names: ["중단영업이익", "중단영업이익(손실)", "중단영업손익"] },
  netIncome:        { sj: IS, ids: ["ifrs-full_ProfitLoss"], names: ["당기순이익", "당기순이익(손실)", "당기순손익"] },
  netIncomeOwners:  { sj: IS, ids: ["ifrs-full_ProfitLossAttributableToOwnersOfParent"], names: ["지배기업의소유주에게귀속되는당기순이익(손실)", "지배기업소유주지분순이익", "지배기업소유주지분"] },
  netIncomeNci:     { sj: IS, ids: ["ifrs-full_ProfitLossAttributableToNoncontrollingInterests"], names: ["비지배지분순이익", "비지배지분에귀속되는당기순이익(손실)", "비지배지분"] },
  eps:              { sj: IS, ids: ["ifrs-full_BasicEarningsLossPerShare", "ifrs-full_BasicEarningsLossPerShareFromContinuingOperations"], names: ["기본주당이익", "기본주당순이익", "기본주당이익(손실)", "기본주당손익"] },
  comprehensiveIncome: { sj: ["CIS", "IS"], ids: ["ifrs-full_ComprehensiveIncome"], names: ["총포괄손익", "총포괄이익", "당기총포괄이익"] },

  // 재무상태표
  totalAssets:      { sj: ["BS"], ids: ["ifrs-full_Assets"], names: ["자산총계"] },
  currentAssets:    { sj: ["BS"], ids: ["ifrs-full_CurrentAssets"], names: ["유동자산"] },
  cash:             { sj: ["BS"], ids: ["ifrs-full_CashAndCashEquivalents"], names: ["현금및현금성자산"] },
  receivables:      { sj: ["BS"], ids: ["ifrs-full_TradeAndOtherCurrentReceivables", "ifrs-full_CurrentTradeReceivables"], names: ["매출채권및기타채권", "매출채권", "매출채권및기타유동채권"] },
  inventories:      { sj: ["BS"], ids: ["ifrs-full_Inventories"], names: ["재고자산"] },
  ppe:              { sj: ["BS"], ids: ["ifrs-full_PropertyPlantAndEquipment"], names: ["유형자산"] },
  rightOfUse:       { sj: ["BS"], ids: ["ifrs-full_RightofuseAssets"], names: ["사용권자산"] },
  totalLiabilities: { sj: ["BS"], ids: ["ifrs-full_Liabilities"], names: ["부채총계"] },
  currentLiabilities: { sj: ["BS"], ids: ["ifrs-full_CurrentLiabilities"], names: ["유동부채"] },
  payables:         { sj: ["BS"], ids: ["ifrs-full_TradeAndOtherCurrentPayables", "ifrs-full_CurrentTradePayables"], names: ["매입채무및기타채무", "매입채무", "매입채무및기타유동채무"] },
  totalEquity:      { sj: ["BS"], ids: ["ifrs-full_Equity"], names: ["자본총계"] },
  equityOwners:     { sj: ["BS"], ids: ["ifrs-full_EquityAttributableToOwnersOfParent"], names: ["지배기업의소유주에게귀속되는자본", "지배기업소유주지분"] },
  nonControlling:   { sj: ["BS"], ids: ["ifrs-full_NoncontrollingInterests"], names: ["비지배지분"] },
  // 이자 붙는 차입금·사채 (리스부채 제외)
  borrowings: { sj: ["BS"], sum: true,
    ids: ["ifrs-full_ShorttermBorrowings", "ifrs-full_CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings", "ifrs-full_CurrentPortionOfLongtermBorrowings",
      "ifrs-full_LongtermBorrowings", "ifrs-full_NoncurrentPortionOfNoncurrentBorrowings", "ifrs-full_Borrowings", "ifrs-full_BondsIssued",
      "dart_ShortTermBorrowings", "dart_CurrentPortionOfBonds", "dart_CurrentPortionOfLongTermBorrowings", "dart_BondsIssuedNominalValue", "dart_LongTermBorrowingsGross"],
    names: ["단기차입금", "유동성장기차입금", "유동성사채", "사채", "장기차입금", "차입금및사채", "단기사채", "전환사채", "교환사채", "유동성장기부채", "차입금"] },
  leaseLiabilities: { sj: ["BS"], sum: true, ids: ["ifrs-full_CurrentLeaseLiabilities", "ifrs-full_NoncurrentLeaseLiabilities", "ifrs-full_LeaseLiabilities"], names: ["리스부채", "유동리스부채", "비유동리스부채"] },
  // 영업에 쓰지 않는 금융자산(강의 6장: 실무에선 현금성자산도 재무자산으로 봄)
  financialAssets: { sj: ["BS"], sum: true,
    ids: ["ifrs-full_CashAndCashEquivalents", "ifrs-full_ShorttermDepositsNotClassifiedAsCashEquivalents", "dart_ShortTermDepositsNotClassifiedAsCashEquivalents", "dart_LongTermDepositsNotClassifiedAsCashEquivalents"],
    prefixes: ["ifrs-full_CurrentFinancialAssetsAtFairValueThroughProfitOrLoss"],
    names: ["현금및현금성자산", "단기금융상품", "단기투자자산", "장기금융상품"] },

  // 현금흐름표
  operatingCashFlow: { sj: ["CF"], ids: ["ifrs-full_CashFlowsFromUsedInOperatingActivities"], names: ["영업활동현금흐름", "영업활동으로인한현금흐름"] },
  investingCashFlow: { sj: ["CF"], ids: ["ifrs-full_CashFlowsFromUsedInInvestingActivities"], names: ["투자활동현금흐름", "투자활동으로인한현금흐름"] },
  financingCashFlow: { sj: ["CF"], ids: ["ifrs-full_CashFlowsFromUsedInFinancingActivities"], names: ["재무활동현금흐름", "재무활동으로인한현금흐름"] },
  capex:            { sj: ["CF"], sum: true, abs: true, prefixes: ["ifrs-full_PurchaseOfPropertyPlantAndEquipment"], names: ["유형자산의취득"] },
  capexIntangible:  { sj: ["CF"], sum: true, abs: true, prefixes: ["ifrs-full_PurchaseOfIntangibleAssets"], names: ["무형자산의취득"] },
  ppeDisposal:      { sj: ["CF"], sum: true, abs: true, prefixes: ["ifrs-full_ProceedsFromSalesOfPropertyPlantAndEquipment"], names: ["유형자산의처분"] },
  interestPaidOp:   { sj: ["CF"], sum: true, abs: true, ids: ["ifrs-full_InterestPaidClassifiedAsOperatingActivities"] },
  interestPaidFin:  { sj: ["CF"], sum: true, abs: true, ids: ["ifrs-full_InterestPaidClassifiedAsFinancingActivities"] },
  interestReceivedOp: { sj: ["CF"], sum: true, abs: true, ids: ["ifrs-full_InterestReceivedClassifiedAsOperatingActivities"] },
  taxesPaid:        { sj: ["CF"], sum: true, prefixes: ["ifrs-full_IncomeTaxesPaidRefund"] },
  dividendsPaid:    { sj: ["CF"], sum: true, abs: true, prefixes: ["ifrs-full_DividendsPaidClassifiedAs"], names: ["배당금지급", "배당금의지급"] },
  treasuryShares:   { sj: ["CF"], sum: true, abs: true, ids: ["ifrs-full_PurchaseOfTreasuryShares", "dart_AcquisitionOfTreasuryShares"], names: ["자기주식의취득"] },
  leaseRepayment:   { sj: ["CF"], sum: true, abs: true, ids: ["dart_PaymentsOfFinanceLeaseLiabilitiesClassifiedAsFinancingActivities", "ifrs-full_PaymentsOfLeaseLiabilitiesClassifiedAsFinancingActivities"], names: ["리스부채의상환", "리스부채의감소"] },
  debtIssued:       { sj: ["CF"], sum: true, abs: true,
    ids: ["dart_ProceedsFromBonds", "dart_ProceedsFromLongTermBorrowings", "dart_ProceedsFromShortTermBorrowings", "ifrs-full_ProceedsFromBorrowingsClassifiedAsFinancingActivities",
      "ifrs-full_ProceedsFromNoncurrentBorrowings", "ifrs-full_ProceedsFromCurrentBorrowings", "ifrs-full_ProceedsFromIssueOfBondsNotesAndDebentures"],
    names: ["사채의발행", "장기차입금의차입", "장기차입금의증가", "단기차입금의차입", "단기차입금의증가"], exclude: /증감/ },
  debtRepaid:       { sj: ["CF"], sum: true, abs: true,
    ids: ["dart_RepaymentsOfBonds", "dart_RepaymentsOfLongTermBorrowings", "dart_RepaymentsOfShortTermBorrowings", "ifrs-full_RepaymentsOfNoncurrentBorrowings",
      "ifrs-full_RepaymentsOfCurrentBorrowings", "ifrs-full_RepaymentsOfBorrowingsClassifiedAsFinancingActivities", "ifrs-full_RepaymentsOfBondsNotesAndDebentures"],
    names: ["사채의상환", "유동성사채의상환", "장기차입금의상환", "단기차입금의상환", "유동성장기차입금의상환", "유동성장기차입금의감소", "단기차입금의감소"] },
  // "단기차입금의 순증감"처럼 순액으로 적는 회사는 부호를 살려서 따로 더한다
  debtNetChange:    { sj: ["CF"], sum: true, pattern: /차입금.*증감/ },
};

const SECTION_IDS = {
  "ifrs-full_CashFlowsFromUsedInOperatingActivities": "operating",
  "ifrs-full_CashFlowsFromUsedInInvestingActivities": "investing",
  "ifrs-full_CashFlowsFromUsedInFinancingActivities": "financing",
};
// 구간 밖의 현금 증감·기초·기말 행
const CASH_SUMMARY = /기초.*현금|기말.*현금|현금및현금성자산의(순)?증가|현금.*순증|환율변동효과/;

const norm = (s) => String(s || "").replace(/\s/g, "");

function parseAmount(s) {
  if (s === undefined || s === null) return null;
  const t = String(s).replace(/,/g, "").trim();
  if (t === "" || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function matches(row, def) {
  if (def.exclude?.test(norm(row.account_nm))) return false;
  if (def.pattern?.test(norm(row.account_nm))) return true;
  if (def.ids?.includes(row.account_id)) return true;
  if (def.prefixes?.some((p) => row.account_id.startsWith(p))) return true;
  return !!def.names?.map(norm).includes(norm(row.account_nm));
}

function pickRows(list, def) {
  for (const sj of def.sj) {
    const rows = list.filter((r) => r.sj_div === sj);
    if (def.sum) {
      const hit = rows.filter((r) => matches(r, def));
      if (hit.length) return hit;
      continue;
    }
    // 단일 계정: 태그 일치를 이름 일치보다 우선
    const row = rows.find((r) => def.ids?.includes(r.account_id) || def.prefixes?.some((p) => r.account_id.startsWith(p)))
      || rows.find((r) => def.names?.map(norm).includes(norm(r.account_nm)));
    if (row) return [row];
  }
  return [];
}

async function fetchReport(corp_code, year, fs_div) {
  const body = await dart("fnlttSinglAcntAll.json", { corp_code, bsns_year: year, reprt_code: ANNUAL_REPORT, fs_div });
  return body.status === "000" && Array.isArray(body.list) && body.list.length ? body.list : null;
}

const COLUMNS = [["thstrm_amount", 0], ["frmtrm_amount", 1], ["bfefrmtrm_amount", 2]];

// 보고서 하나 → { year: { key: amount } } (당기·전기·전전기)
function extract(list, year) {
  const out = { [year]: {}, [year - 1]: {}, [year - 2]: {} };
  for (const [key, def] of Object.entries(ACCOUNTS)) {
    const rows = pickRows(list, def);
    if (!rows.length) continue;
    for (const [col, back] of COLUMNS) {
      const vals = rows.map((r) => parseAmount(r[col])).filter((v) => v !== null);
      if (!vals.length) continue;
      out[year - back][key] = vals.reduce((s, v) => s + (def.abs ? Math.abs(v) : v), 0);
    }
  }
  return out;
}

// 현금흐름표 전체 행을 영업/투자/재무 구간으로 나눈다.
// DART는 행을 표시 순서가 아니라 태그 순으로 주지만, 각 구간 합계 행 뒤에 그 구간 항목이 이어진다.
function cashFlowRows(list, year) {
  const rows = list.filter((r) => r.sj_div === "CF").sort((a, b) => Number(a.ord) - Number(b.ord));
  let section = "other";
  return rows.map((r) => {
    const sec = SECTION_IDS[r.account_id] || (/^영업활동/.test(norm(r.account_nm)) && /현금흐름$/.test(norm(r.account_nm)) ? "operating"
      : /^투자활동/.test(norm(r.account_nm)) && /현금흐름$/.test(norm(r.account_nm)) ? "investing"
      : /^재무활동/.test(norm(r.account_nm)) && /현금흐름$/.test(norm(r.account_nm)) ? "financing" : null);
    const isTotal = !!sec;
    if (sec) section = sec;
    const values = {};
    for (const [col, back] of COLUMNS) values[year - back] = parseAmount(r[col]);
    const rowSection = isTotal ? sec : CASH_SUMMARY.test(norm(r.account_nm)) ? "other" : section;
    return { section: rowSection, total: isTotal, id: r.account_id, name: r.account_nm.trim(), values };
  });
}

// 두 보고서의 현금흐름 행을 같은 계정끼리 합친다 (최신 보고서의 행 구성을 기준으로)
function mergeCashFlow(latest, older) {
  const key = (r) => `${r.section}|${r.id.startsWith("-") ? norm(r.name) : r.id}`;
  const map = new Map(latest.map((r) => [key(r), r]));
  for (const r of older || []) {
    const hit = map.get(key(r));
    if (hit) for (const [y, v] of Object.entries(r.values)) if (hit.values[y] === undefined) hit.values[y] = v;
  }
  return latest;
}

module.exports = async (req, res) => {
  try {
    const { corp_code } = req.query;
    if (!isCorpCode(corp_code)) throw new HttpError(400, "corp_code는 8자리 숫자여야 합니다.");
    const fsWanted = req.query.fs === "OFS" ? "OFS" : "CFS";
    const thisYear = new Date().getFullYear();
    const endYear = Math.min(Number(req.query.year) || thisYear - 1, thisYear);

    // 가장 흔한 경우(요청 연도 보고서 존재)를 가정해 최신·과거 보고서를 동시에 요청 → 대기 시간 절반
    let [list, olderList] = await Promise.all([fetchReport(corp_code, endYear, fsWanted), fetchReport(corp_code, endYear - 3, fsWanted)]);
    let latest = list ? { year: endYear, fs: fsWanted, list } : null;

    // 없으면: 자회사가 없어 연결(CFS)이 없는 기업은 별도(OFS)로, 아직 공시 전이면 이전 연도로
    if (!latest) {
      const tries = [];
      for (let y = endYear; y >= endYear - 2; y--) {
        for (const fs of fsWanted === "CFS" ? ["CFS", "OFS"] : ["OFS"]) if (!(y === endYear && fs === fsWanted)) tries.push([y, fs]);
      }
      for (const [y, fs] of tries) {
        const l = await fetchReport(corp_code, y, fs);
        if (l) { latest = { year: y, fs, list: l }; break; }
      }
      if (!latest) throw new HttpError(404, `${endYear - 2}~${endYear}년 사업보고서 재무제표가 없습니다.`);
      olderList = await fetchReport(corp_code, latest.year - 3, latest.fs);
    }

    const byYear = extract(latest.list, latest.year);
    if (olderList) Object.assign(byYear, extract(olderList, latest.year - 3));

    const years = Object.keys(byYear).map(Number).sort((a, b) => a - b)
      .filter((y) => Object.values(byYear[y]).some((v) => v !== null && v !== undefined));
    const data = {};
    for (const key of Object.keys(ACCOUNTS)) {
      data[key] = {};
      for (const y of years) data[key][y] = byYear[y][key] ?? null;
    }
    // 검산: 지배주주 자본 = 자본총계 − 비지배지분. 회사가 태그를 잘못 붙인 경우(예: 납입자본에 지배주주 자본 태그) 계산값으로 바로잡는다
    for (const y of years) {
      const te = data.totalEquity[y], nci = data.nonControlling[y], eo = data.equityOwners[y];
      if (te == null || nci == null) continue;
      const calc = te - nci;
      if (eo == null || Math.abs(eo - calc) > Math.abs(calc) * 0.02) data.equityOwners[y] = calc;
    }

    // 공시 원문 링크용 접수번호 (최신 보고서: 최근 3년, 과거 보고서: 그 이전 3년)
    const sources = {};
    for (let i = 0; i < 3; i++) sources[latest.year - i] = latest.list[0].rcept_no;
    if (olderList) for (let i = 3; i < 6; i++) sources[latest.year - i] = olderList[0].rcept_no;

    send(res, 200, {
      corp_code,
      fs_div: latest.fs,
      latest_year: latest.year,
      currency: latest.list[0].currency || "KRW",
      years,
      data,
      cashFlow: mergeCashFlow(cashFlowRows(latest.list, latest.year), olderList && cashFlowRows(olderList, latest.year - 3))
        .map((r) => ({ ...r, values: Object.fromEntries(years.map((y) => [y, r.values[y] ?? null])) })),
      sources,
    }, 86400);
  } catch (err) {
    handleError(res, err);
  }
};
