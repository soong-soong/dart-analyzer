// GET /api/financials?corp_code=00126380&year=2025&fs=CFS
// 사업보고서(11011) 단일회사 전체 재무제표를 받아 주요 계정만 연도별로 정리해 돌려준다.
// 보고서 1건에 당기·전기·전전기 3개년이 들어 있으므로, 2건을 조회해 최대 6개년을 만든다.
const { dart, isCorpCode, send, handleError, HttpError } = require("./_dart");

const ANNUAL_REPORT = "11011";

// key: 화면에서 쓰는 이름. ids(IFRS 태그)를 먼저 찾고, 없으면 계정명(공백 제거)으로 찾는다.
const ACCOUNTS = {
  revenue:          { sj: ["IS", "CIS"], ids: ["ifrs-full_Revenue"], names: ["매출액", "수익(매출액)", "영업수익", "매출", "매출및지분법손익"] },
  costOfSales:      { sj: ["IS", "CIS"], ids: ["ifrs-full_CostOfSales"], names: ["매출원가"] },
  grossProfit:      { sj: ["IS", "CIS"], ids: ["ifrs-full_GrossProfit"], names: ["매출총이익", "매출총이익(손실)"] },
  operatingIncome:  { sj: ["IS", "CIS"], ids: ["dart_OperatingIncomeLoss"], names: ["영업이익", "영업이익(손실)", "영업손익"] },
  netIncome:        { sj: ["IS", "CIS"], ids: ["ifrs-full_ProfitLoss"], names: ["당기순이익", "당기순이익(손실)", "당기순손익"] },
  netIncomeOwners:  { sj: ["IS", "CIS"], ids: ["ifrs-full_ProfitLossAttributableToOwnersOfParent"], names: ["지배기업의소유주에게귀속되는당기순이익(손실)", "지배기업소유주지분"] },
  totalAssets:      { sj: ["BS"], ids: ["ifrs-full_Assets"], names: ["자산총계"] },
  currentAssets:    { sj: ["BS"], ids: ["ifrs-full_CurrentAssets"], names: ["유동자산"] },
  cash:             { sj: ["BS"], ids: ["ifrs-full_CashAndCashEquivalents"], names: ["현금및현금성자산"] },
  inventories:      { sj: ["BS"], ids: ["ifrs-full_Inventories"], names: ["재고자산"] },
  totalLiabilities: { sj: ["BS"], ids: ["ifrs-full_Liabilities"], names: ["부채총계"] },
  currentLiabilities: { sj: ["BS"], ids: ["ifrs-full_CurrentLiabilities"], names: ["유동부채"] },
  totalEquity:      { sj: ["BS"], ids: ["ifrs-full_Equity"], names: ["자본총계"] },
  equityOwners:     { sj: ["BS"], ids: ["ifrs-full_EquityAttributableToOwnersOfParent"], names: ["지배기업의소유주에게귀속되는자본", "지배기업소유주지분"] },
  operatingCashFlow: { sj: ["CF"], ids: ["ifrs-full_CashFlowsFromUsedInOperatingActivities"], names: ["영업활동현금흐름", "영업활동으로인한현금흐름"] },
  capex:            { sj: ["CF"], ids: ["ifrs-full_PurchaseOfPropertyPlantAndEquipment"], names: ["유형자산의취득"] },
};

const norm = (s) => String(s || "").replace(/\s/g, "");

function parseAmount(s) {
  if (s === undefined || s === null) return null;
  const t = String(s).replace(/,/g, "").trim();
  if (t === "" || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function pickRow(list, def) {
  const names = def.names.map(norm);
  for (const sj of def.sj) {
    const rows = list.filter((r) => r.sj_div === sj);
    const row = rows.find((r) => def.ids.includes(r.account_id)) || rows.find((r) => names.includes(norm(r.account_nm)));
    if (row) return row;
  }
  return null;
}

async function fetchReport(corp_code, year, fs_div) {
  const body = await dart("fnlttSinglAcntAll.json", { corp_code, bsns_year: year, reprt_code: ANNUAL_REPORT, fs_div });
  return body.status === "000" && Array.isArray(body.list) && body.list.length ? body.list : null;
}

// 보고서 하나 → { year: { key: amount } } (당기·전기·전전기)
function extract(list, year) {
  const out = { [year]: {}, [year - 1]: {}, [year - 2]: {} };
  for (const [key, def] of Object.entries(ACCOUNTS)) {
    const row = pickRow(list, def);
    if (!row) continue;
    out[year][key] = parseAmount(row.thstrm_amount);
    out[year - 1][key] = parseAmount(row.frmtrm_amount);
    out[year - 2][key] = parseAmount(row.bfefrmtrm_amount);
  }
  return out;
}

module.exports = async (req, res) => {
  try {
    const { corp_code } = req.query;
    if (!isCorpCode(corp_code)) throw new HttpError(400, "corp_code는 8자리 숫자여야 합니다.");
    const fsWanted = req.query.fs === "OFS" ? "OFS" : "CFS";
    const thisYear = new Date().getFullYear();
    const endYear = Math.min(Number(req.query.year) || thisYear - 1, thisYear);

    // 가장 최근 사업보고서 찾기. 자회사가 없는 기업은 연결(CFS)이 없으므로 별도(OFS)로 대체.
    let latest = null;
    for (let y = endYear; y >= endYear - 2 && !latest; y--) {
      for (const fs of fsWanted === "CFS" ? ["CFS", "OFS"] : ["OFS"]) {
        const list = await fetchReport(corp_code, y, fs);
        if (list) { latest = { year: y, fs, list }; break; }
      }
    }
    if (!latest) throw new HttpError(404, `${endYear - 2}~${endYear}년 사업보고서 재무제표가 없습니다.`);

    const byYear = extract(latest.list, latest.year);
    const older = await fetchReport(corp_code, latest.year - 3, latest.fs);
    if (older) Object.assign(byYear, extract(older, latest.year - 3));

    const years = Object.keys(byYear).map(Number).sort((a, b) => a - b)
      .filter((y) => Object.values(byYear[y]).some((v) => v !== null && v !== undefined));
    const data = {};
    for (const key of Object.keys(ACCOUNTS)) {
      data[key] = {};
      for (const y of years) data[key][y] = byYear[y][key] ?? null;
    }

    send(res, 200, {
      corp_code,
      fs_div: latest.fs,
      latest_year: latest.year,
      currency: latest.list[0].currency || "KRW",
      years,
      data,
    }, 86400);
  } catch (err) {
    handleError(res, err);
  }
};
