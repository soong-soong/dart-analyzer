// GET /api/governance?corp_code=00428251&year=2025
// 사업보고서의 비재무 정보: 최대주주·소액주주 지분, 임원 구성, 배당, 감사의견, 직원 현황.
const { dart, isCorpCode, send, handleError, HttpError } = require("./_dart");

const num = (s) => {
  const n = Number(String(s ?? "").replace(/[,%\s]/g, ""));
  return Number.isFinite(n) && String(s ?? "").trim() !== "-" && String(s ?? "").trim() !== "" ? n : null;
};

// 항목 하나가 실패해도 나머지는 보여준다
async function list(path, params) {
  try {
    const body = await dart(path, { ...params, reprt_code: "11011" });
    return body.status === "000" ? body.list : [];
  } catch {
    return null;
  }
}

function holders(rows) {
  if (!rows) return null;
  const common = rows.filter((r) => !r.stock_knd || r.stock_knd.includes("보통"));
  const total = common.find((r) => r.nm === "계");
  const people = common.filter((r) => r.nm !== "계")
    .map((r) => ({ name: r.nm, relation: r.relate, rate: num(r.trmend_posesn_stock_qota_rt) }))
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
  return { total: total ? num(total.trmend_posesn_stock_qota_rt) : null, top: people.slice(0, 5) };
}

function minority(rows) {
  const r = rows?.[0];
  return r ? { holderRate: num(r.shrholdr_rate), shareRate: num(r.hold_stock_rate), holders: num(r.shrholdr_co) } : null;
}

function executives(rows) {
  if (!rows) return null;
  const registered = rows.filter((r) => !/미등기/.test(r.rgist_exctv_at || ""));
  return {
    total: rows.length,
    registered: registered.length,
    outside: registered.filter((r) => /사외이사/.test(r.rgist_exctv_at)).length,
    femaleRegistered: registered.filter((r) => r.sexdstn === "여").length,
    female: rows.filter((r) => r.sexdstn === "여").length,
  };
}

const DIVIDEND_ROWS = [
  [/주당\s*현금배당금/, "주당 현금배당금(원)"],
  [/현금배당성향/, "현금배당성향(%)"],
  [/현금배당수익률/, "현금배당수익률(%)"],
  [/현금배당금총액/, "현금배당금 총액(백만원)"],
  [/\(연결\)주당순이익/, "연결 주당순이익(원)"],
];

function dividends(rows) {
  if (!rows) return null;
  return DIVIDEND_ROWS.map(([re, label]) => {
    const r = rows.find((x) => re.test(x.se) && (!x.stock_knd || x.stock_knd === "-" || x.stock_knd.includes("보통")));
    return r ? { label, values: [num(r.thstrm), num(r.frmtrm), num(r.lwfr)] } : null;
  }).filter(Boolean);
}

function audits(rows) {
  if (!rows) return null;
  const byYear = new Map();
  for (const r of rows) {
    const label = String(r.bsns_year || "").replace(/\s+/g, " ").trim();
    const prev = byYear.get(label);
    const kam = r.core_adt_matter && r.core_adt_matter !== "-" ? r.core_adt_matter.replace(/\s+/g, " ").trim() : null;
    if (prev) { if (kam && !prev.keyMatters.includes(kam)) prev.keyMatters.push(kam); continue; }
    byYear.set(label, {
      period: label,
      auditor: r.adtor,
      opinion: r.adt_opinion,
      emphasis: r.emphs_matter && !/해당사항\s*없음|^-$/.test(r.emphs_matter) ? r.emphs_matter.replace(/\s+/g, " ").trim() : null,
      keyMatters: kam ? [kam] : [],
    });
  }
  return [...byYear.values()];
}

// 보통주 주식 수 (시가총액·주당 지표 계산용)
// 구분 이름이 회사마다 달라("보통주", "의결권 있는 주식", "의결권 있는\n보통주") 순서대로 찾는다
function shares(rows) {
  const se = (x) => String(x.se || "").replace(/\s/g, "");
  const r = rows?.find((x) => se(x) === "보통주") || rows?.find((x) => /보통주/.test(se(x)))
    || rows?.find((x) => /^의결권있는/.test(se(x))) || rows?.find((x) => se(x) === "합계");
  if (!r) return null;
  const issued = num(r.istc_totqy), treasury = num(r.tesstk_co);
  const outstanding = num(r.distb_stock_co) ?? (issued == null ? null : issued - (treasury ?? 0));
  return outstanding ? { issued, treasury, outstanding } : null;
}

function employees(rows) {
  if (!rows?.length) return null;
  const count = rows.reduce((s, r) => s + (num(r.sm) ?? 0), 0);
  const salary = rows.reduce((s, r) => s + (num(r.fyer_salary_totamt) ?? 0), 0);
  const female = rows.filter((r) => r.sexdstn === "여").reduce((s, r) => s + (num(r.sm) ?? 0), 0);
  const tenure = rows.reduce((s, r) => s + (num(r.avrg_cnwk_sdytrn) ?? 0) * (num(r.sm) ?? 0), 0);
  return {
    count,
    femaleRate: count ? (female / count) * 100 : null,
    avgTenure: count ? tenure / count : null,
    avgSalary: count && salary ? salary / count : null, // 원
  };
}

module.exports = async (req, res) => {
  try {
    const { corp_code } = req.query;
    if (!isCorpCode(corp_code)) throw new HttpError(400, "corp_code는 8자리 숫자여야 합니다.");
    const year = Number(req.query.year) || new Date().getFullYear() - 1;
    const p = { corp_code, bsns_year: year };

    const [h, m, e, d, a, emp, st] = await Promise.all([
      list("hyslrSttus.json", p), list("mrhlSttus.json", p), list("exctvSttus.json", p),
      list("alotMatter.json", p), list("accnutAdtorNmNdAdtOpinion.json", p), list("empSttus.json", p),
      list("stockTotqySttus.json", p),
    ]);

    send(res, 200, {
      year,
      holders: holders(h),
      minority: minority(m),
      executives: executives(e),
      dividends: dividends(d),
      audits: audits(a),
      employees: employees(emp),
      shares: shares(st),
    }, 86400);
  } catch (err) {
    handleError(res, err);
  }
};
