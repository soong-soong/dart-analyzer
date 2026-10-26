import { industryName, isFinancial } from "./ksic.js";
import { RATIOS, computeRatios } from "./ratios.js";
import { bridge, cashFlow, roeTree, dupont, flags, auditFlags, equityGrowth, valueCreation, valuation } from "./analysis.js";
import { esc, eok, eokLabel, fmt } from "./core.js";

const MAX = 4;
const COLORS = ["#2f6fed", "#e8743b", "#19a979", "#9b59b6"];
const DEFAULT_CORPS = ["00136378", "00428251"]; // 첫 방문 시 예시: 신세계, 현대백화점
const TABS = ["ratios", "profit", "bridge", "cash", "stability", "gov", "statements"];
const SINGLE_COMPANY_TABS = new Set(["profit", "bridge", "cash", "statements"]);

const STATEMENT_ROWS = [
  ["revenue", "매출액"], ["costOfSales", "매출원가"], ["grossProfit", "매출총이익"], ["sga", "판매비와관리비"],
  ["operatingIncome", "영업이익"], ["netIncome", "당기순이익"], ["netIncomeOwners", "지배주주 순이익"],
  ["totalAssets", "자산총계"], ["currentAssets", "유동자산"], ["cash", "현금및현금성자산"], ["financialAssets", "재무자산(현금성 포함)"],
  ["receivables", "매출채권및기타채권"], ["inventories", "재고자산"], ["ppe", "유형자산"], ["rightOfUse", "사용권자산"],
  ["totalLiabilities", "부채총계"], ["currentLiabilities", "유동부채"], ["payables", "매입채무및기타채무"],
  ["borrowings", "차입금+사채"], ["leaseLiabilities", "리스부채"],
  ["totalEquity", "자본총계"], ["equityOwners", "지배주주 자본"],
  ["operatingCashFlow", "영업활동현금흐름"], ["investingCashFlow", "투자활동현금흐름"], ["financingCashFlow", "재무활동현금흐름"],
];

// 공통형 재무제표의 분모: 손익·현금흐름은 매출액, 재무상태표는 총자산
const ROW_BASE = Object.fromEntries(STATEMENT_ROWS.map(([k]) => [k,
  ["totalAssets", "currentAssets", "cash", "financialAssets", "receivables", "inventories", "ppe", "rightOfUse", "totalLiabilities",
    "currentLiabilities", "payables", "borrowings", "leaseLiabilities", "totalEquity", "equityOwners"].includes(k) ? "totalAssets" : "revenue"]));

const TAB_LABEL = { ratios: "재무비율", profit: "수익성 분해", bridge: "손익 브리지", cash: "현금흐름", stability: "안정성·효율성", gov: "지배구조·배당", statements: "재무제표" };

const $ = (id) => document.getElementById(id);
const toEok = (won) => (won == null ? null : won / 1e8);

// 사용자가 입력하는 값(무위험이자율·베타·주가)은 이 브라우저에만 저장
const PREFS_KEY = "dart-analyzer:prefs";
const prefs = (() => {
  const base = { rf: 3, mrp: 5, beta: {}, price: {} };
  try { return { ...base, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") }; } catch { return base; }
})();
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* 저장 불가 환경 */ } };

const state = {
  corps: [],          // [corp_code, corp_name, stock_code, induty_code]
  byCode: new Map(),
  selected: [],       // { code, name, color, company, fin, ratios, gov, error, loading }
  fs: "CFS",
  year: new Date().getFullYear() - 1,
  basis: "avg",
  tab: "ratios",
  focus: null,
  focusYear: null,
};
const charts = {};

// ---------- 데이터 ----------
async function api(path) {
  const r = await fetch(path);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `요청 실패 (${r.status})`);
  return body;
}

async function loadCorps() {
  try {
    const j = await api("data/corps.json");
    state.corps = j.corps;
    state.corps.forEach((c) => state.byCode.set(c[0], c));
    $("corpsInfo").textContent = j.updated === "seed"
      ? "샘플 목록(10개)만 검색됩니다 — README의 'Update corp list' 실행 후 전체 상장사가 검색됩니다."
      : `상장사 ${j.corps.length.toLocaleString()}곳 · 목록 갱신 ${j.updated}`;
  } catch {
    $("corpsInfo").textContent = "기업 목록을 불러오지 못했습니다.";
  }
}

async function loadCompany(item) {
  item.loading = true;
  item.error = null;
  render();
  // 기업 개황과 재무제표를 따로 처리: 재무제표가 없어도(상장폐지 법인 등) 회사 정보와 안내는 보이게
  const [company, fin] = await Promise.allSettled([
    item.company ? Promise.resolve(item.company) : api(`/api/company?corp_code=${item.code}`),
    api(`/api/financials?corp_code=${item.code}&fs=${state.fs}&year=${state.year}`),
  ]);
  if (company.status === "fulfilled") {
    item.company = company.value;
    item.name = company.value.corp_name;
  }
  if (fin.status === "fulfilled") {
    item.fin = fin.value;
    item.ratios = computeRatios(fin.value, state.basis);
  } else {
    item.error = fin.reason.message;
    item.fin = null;
    item.ratios = null;
  }
  if (company.status === "rejected" && !item.error) item.error = company.reason.message;
  item.loading = false;
  render();
  // 지배구조·배당·감사는 화면을 막지 않도록 뒤이어 불러온다
  if (item.fin && item.gov?.year !== item.fin.latest_year) {
    api(`/api/governance?corp_code=${item.code}&year=${item.fin.latest_year}`)
      .then((g) => { item.gov = g; })
      .catch((e) => { item.gov = { error: e.message }; })
      .finally(render);
  }
}

function addCorp(code) {
  if (state.selected.some((s) => s.code === code)) return;
  if (state.selected.length >= MAX) { alert(`최대 ${MAX}개 기업까지 비교할 수 있습니다.`); return; }
  const used = new Set(state.selected.map((s) => s.color));
  const item = { code, name: state.byCode.get(code)?.[1] || code, color: COLORS.find((c) => !used.has(c)) };
  state.selected.push(item);
  syncUrl();
  loadCompany(item);
}

function removeCorp(code) {
  state.selected = state.selected.filter((s) => s.code !== code);
  if (state.focus === code) state.focus = null;
  syncUrl();
  render();
}

function setCorps(codes) {
  state.selected = [];
  state.focus = null;
  codes.forEach(addCorp);
  render();
}

function reloadAll() {
  syncUrl();
  state.selected.forEach(loadCompany);
}

// 공유 가능한 링크: ?c=코드,코드&fs=CFS&y=2025&b=avg&t=bridge
function syncUrl() {
  const p = new URLSearchParams();
  if (state.selected.length) p.set("c", state.selected.map((s) => s.code).join(","));
  p.set("fs", state.fs);
  p.set("y", state.year);
  if (state.basis !== "avg") p.set("b", state.basis);
  if (state.tab !== "ratios") p.set("t", state.tab);
  history.replaceState(null, "", `?${p}`);
}

// ---------- 검색 ----------
function setupSearch() {
  const q = $("q"), list = $("suggest");
  let matches = [], active = 0;

  const close = () => { list.hidden = true; };
  const pick = (i) => { if (matches[i]) { addCorp(matches[i][0]); q.value = ""; close(); } };

  q.addEventListener("input", () => {
    const t = q.value.trim().toLowerCase();
    if (!t) return close();
    matches = state.corps.filter((c) => c[1].toLowerCase().includes(t) || c[2].startsWith(t))
      .sort((a, b) => (a[1].toLowerCase().startsWith(t) ? 0 : 1) - (b[1].toLowerCase().startsWith(t) ? 0 : 1))
      .slice(0, 8);
    active = 0;
    list.innerHTML = matches.length
      ? matches.map((c, i) => `<li role="option" data-i="${i}" class="${i === 0 ? "active" : ""}"><span>${esc(c[1])}</span><span class="muted">${c[2]}</span></li>`).join("")
      : `<li class="muted">검색 결과 없음</li>`;
    list.hidden = false;
  });
  q.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
      [...list.children].forEach((li, i) => li.classList.toggle("active", i === active));
    } else if (e.key === "Enter") { e.preventDefault(); pick(active); }
    else if (e.key === "Escape") close();
  });
  list.addEventListener("mousedown", (e) => { const li = e.target.closest("li[data-i]"); if (li) pick(Number(li.dataset.i)); });
  q.addEventListener("blur", () => setTimeout(close, 100));
}

// ---------- 공통 ----------
const loaded = () => state.selected.filter((s) => s.fin && s.ratios);

/** 비교 연도: 선택한 분석 연도가 그 회사 데이터에 있으면 그 해, 없으면 최신 연도 */
const yearFor = (item) => (state.focusYear && item.fin.years.includes(state.focusYear) ? state.focusYear : item.fin.latest_year);

function focusItem() {
  const items = loaded();
  return items.find((s) => s.code === state.focus) || items[0] || null;
}

function headCells(items, withYear = true) {
  return items.map((s) => `<th style="color:${s.color}">${esc(s.name)}${withYear ? `<span class="th-year">${yearFor(s)}</span>` : ""}</th>`).join("");
}

function chart(id, config) {
  charts[id]?.destroy();
  if (!window.Chart) return;
  charts[id] = new Chart($(id), config);
}

function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const g = (n) => cs.getPropertyValue(n).trim();
  return { text: g("--muted"), grid: g("--border"), good: g("--good"), bad: g("--bad"), accent: g("--accent"), neutral: g("--neutral") };
}

function baseOptions(yFormat, { xFormat, legend = true } = {}) {
  const { text, grid } = themeColors();
  return {
    responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
    plugins: { legend: { display: legend, labels: { color: text, boxWidth: 12 } },
      tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${yFormat(ctx.parsed.y)}` } } },
    scales: {
      x: { ticks: { color: text, ...(xFormat ? { callback: (v) => xFormat(v) } : {}) }, grid: { color: grid } },
      y: { ticks: { color: text, callback: (v) => yFormat(v) }, grid: { color: grid } },
    },
  };
}

/** 폭포수 차트: items = [{label, value(억원), total}] */
function waterfall(id, items) {
  const { good, bad, neutral, text, grid } = themeColors();
  let run = 0;
  const bars = items.map((it) => {
    if (it.total) { run = it.value; return [0, it.value]; }
    const from = run; run += it.value; return [from, run];
  });
  chart(id, {
    type: "bar",
    data: {
      labels: items.map((i) => i.label),
      datasets: [{
        data: bars,
        backgroundColor: items.map((i) => (i.total ? neutral : i.value >= 0 ? good : bad)),
        borderRadius: 3,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => { const it = items[ctx.dataIndex]; return `${it.total ? "" : it.value >= 0 ? "+" : ""}${eokLabel(it.value)}`; } } } },
      scales: {
        x: { ticks: { color: text, autoSkip: false, maxRotation: 50, minRotation: 0 }, grid: { display: false } },
        y: { ticks: { color: text, callback: (v) => eokLabel(v) }, grid: { color: grid } },
      },
    },
  });
}

/** 과거의 나와 비교 (강의 3장 시계열 비교): 직전 최대 5년 평균 대비 변화 */
function histDelta(s, r) {
  const y = yearFor(s);
  const cur = s.ratios[r.key][y];
  const past = s.fin.years.filter((yy) => yy < y).slice(-5).map((yy) => s.ratios[r.key][yy]).filter((x) => x != null && Number.isFinite(x));
  if (cur == null || past.length < 2) return "";
  const avg = past.reduce((a, b) => a + b, 0) / past.length;
  const d = cur - avg;
  const good = r.better === "high" ? d > 0 : d < 0;
  const size = r.unit === "%" ? `${Math.abs(d).toFixed(1)}%p` : fmt(Math.abs(d), r.unit);
  return `<span class="delta ${good ? "up" : "down"}" title="과거 ${past.length}년 평균 ${fmt(avg, r.unit)} 대비">${d >= 0 ? "▲" : "▼"}${size}</span>`;
}

/** 비율 비교표: 그룹별 행, 회사별 열, 가장 좋은 값 강조 */
function ratioTable(tableId, groups) {
  const items = loaded();
  if (!items.length) { $(tableId).innerHTML = ""; return; }
  let html = `<thead><tr><th>지표</th>${headCells(items)}</tr></thead><tbody>`;
  let group = "";
  for (const r of RATIOS.filter((x) => !groups || groups.includes(x.group))) {
    if (r.group !== group) { group = r.group; html += `<tr class="group"><td colspan="${items.length + 1}">${group}</td></tr>`; }
    const vals = items.map((s) => s.ratios[r.key][yearFor(s)]);
    const valid = vals.filter((v) => v != null && Number.isFinite(v));
    const best = items.length > 1 && valid.length > 1 ? (r.better === "high" ? Math.max(...valid) : Math.min(...valid)) : null;
    html += `<tr><td><span class="formula" title="${esc(r.formula)}">${r.label}</span></td>${vals.map((v, i) => `<td class="${v === best ? "best" : ""}">${fmt(v, r.unit)}${histDelta(items[i], r)}</td>`).join("")}</tr>`;
  }
  $(tableId).innerHTML = html + "</tbody>";
}

// ---------- 렌더링 ----------
function render() {
  const has = state.selected.length > 0;
  $("empty").hidden = has;
  $("results").hidden = !has;

  $("chips").innerHTML = state.selected.map((s) =>
    `<span class="chip"><span class="dot" style="background:${s.color}"></span>${esc(s.name)}${s.loading ? " …" : ""}
      <button data-remove="${s.code}" aria-label="${esc(s.name)} 제거">×</button></span>`).join("");

  if (!has) return;
  renderFocusBar();
  renderProfiles();
  document.querySelectorAll(".tabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === state.tab)));
  document.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== state.tab; });
  ({ ratios: renderRatios, profit: renderProfit, bridge: renderBridge, cash: renderCash,
    stability: renderStability, gov: renderGov, statements: renderStatements })[state.tab]();
}

function renderFocusBar() {
  const items = loaded();
  const years = [...new Set(items.flatMap((s) => s.fin.years))].sort((a, b) => b - a);
  if (state.focusYear && !years.includes(state.focusYear)) state.focusYear = null;
  $("focusYear").innerHTML = `<option value="">각 사 최신</option>` + years.map((y) => `<option value="${y}">${y}년</option>`).join("");
  $("focusYear").value = state.focusYear ? String(state.focusYear) : "";
  const f = focusItem();
  $("focus").innerHTML = items.map((s) => `<option value="${s.code}">${esc(s.name)}</option>`).join("");
  if (f) $("focus").value = f.code;
  $("focus").parentElement.hidden = !SINGLE_COMPANY_TABS.has(state.tab);
  $("focusBar").hidden = state.tab === "gov" || !items.length;
  $("focusNote").textContent = `잔액 기준: ${$("basis").selectedOptions[0].textContent}`;
}

function peersOf(company) {
  if (!company?.induty_code) return [];
  return state.corps.filter((c) => c[3] === company.induty_code && c[0] !== company.corp_code).slice(0, 6);
}

function renderProfiles() {
  const hasIndustryData = state.corps.some((x) => x[3]);
  $("profiles").innerHTML = state.selected.map((s) => {
    const c = s.company;
    if (!c) return `<div class="card profile" style="--c:${s.color}"><h3>${esc(s.name)}</h3>
      ${s.error ? `<p class="error">${esc(s.error)}</p>` : `<p class="loading">불러오는 중…</p>`}</div>`;
    const ind = industryName(c.induty_code);
    const peers = peersOf(c);
    const est = c.est_dt ? `${c.est_dt.slice(0, 4)}.${c.est_dt.slice(4, 6)}.${c.est_dt.slice(6, 8)}` : "–";
    const home = c.homepage ? (c.homepage.startsWith("http") ? c.homepage : `http://${c.homepage}`) : null;
    const fl = [...(s.fin ? flags(s.fin, yearFor(s)) : []), ...auditFlags(s.gov)];
    const latestReport = s.fin?.sources?.[s.fin.latest_year];
    const links = [
      c.stock_code && `<a href="https://finance.naver.com/item/main.naver?code=${esc(c.stock_code)}" target="_blank" rel="noopener">네이버 증권</a>`,
      c.stock_code && `<a href="https://finance.naver.com/research/company_list.naver?searchType=itemCode&itemCode=${esc(c.stock_code)}" target="_blank" rel="noopener">애널리스트 리포트</a>`,
      latestReport && `<a href="https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${esc(latestReport)}" target="_blank" rel="noopener">최근 사업보고서</a>`,
    ].filter(Boolean);
    return `<div class="card profile" style="--c:${s.color}">
      <h3><span>${esc(c.corp_name)}</span><span class="badge">${esc(c.market)} ${esc(c.stock_code)}</span></h3>
      <div class="industry">
        <strong>${esc(ind.minor || ind.major)}</strong>
        <span class="muted small">${ind.minor ? esc(ind.major) + " · " : ""}KSIC ${esc(c.induty_code)}</span>
      </div>
      <dl>
        <dt>대표자</dt><dd>${esc(c.ceo)}</dd>
        <dt>설립일</dt><dd>${est}</dd>
        ${home ? `<dt>홈페이지</dt><dd><a href="${esc(home)}" target="_blank" rel="noopener">${esc(c.homepage)}</a></dd>` : ""}
      </dl>
      ${s.error ? `<p class="error">${esc(s.error)}${c.market === "기타" ? "<br>DART 법인 구분이 '기타'입니다. 상장폐지·합병된 옛 법인일 수 있으니 같은 이름의 다른 회사를 검색해 보세요." : ""}</p>` : ""}
      ${s.fin ? `<p class="muted small">${s.fin.fs_div === "CFS" ? "연결" : "별도"} · ${s.fin.years[0]}~${s.fin.latest_year}년${s.fin.fs_div !== state.fs ? " (연결 없음 → 별도 사용)" : ""}</p>` : ""}
      ${fl.length ? `<ul class="flags">${fl.map((f) => `<li class="${f.level}">${f.level === "warn" ? "🚩" : "ⓘ"} ${esc(f.text)}</li>`).join("")}</ul>` : ""}
      ${links.length ? `<p class="links-row small">${links.join(" · ")}</p>` : ""}
      ${isFinancial(c.induty_code) ? `<p class="muted small">금융업은 매출·영업이익 구조가 달라 일부 비율이 비어 있을 수 있습니다.</p>` : ""}
      <div class="muted small">동종 업종 상장사</div>
      <div class="peers">${peers.length
        ? peers.map((p) => `<button data-add="${p[0]}">+ ${esc(p[1])}</button>`).join("")
        : `<span class="muted small">${hasIndustryData ? "없음" : "업종 데이터 수집 후 표시"}</span>`}</div>
    </div>`;
  }).join("");
}

// --- 재무비율 탭
function renderRatios() {
  const items = loaded();
  $("ratioYear").textContent = items.length ? `비교 연도: ${items.map((s) => `${s.name} ${yearFor(s)}`).join(" · ")}` : "";
  ratioTable("ratioTable");
  if (!items.length) return;
  const years = [...new Set(items.flatMap((s) => s.fin.years))].sort();
  const metric = $("metric").value;
  const asIndex = $("trendMode").value === "index";
  chart("trendChart", {
    type: "line",
    data: { labels: years, datasets: items.map((s) => {
      const series = years.map((y) => s.fin.data[metric]?.[y] ?? null);
      const first = series.find((x) => x != null);
      return {
        label: s.name, borderColor: s.color, backgroundColor: s.color, tension: 0.25, spanGaps: true,
        // 추세 지수: 첫해 값을 100으로 (첫해가 0 이하이면 지수를 만들 수 없음)
        data: asIndex ? series.map((x) => (x == null || !(first > 0) ? null : (x / first) * 100)) : series.map(toEok),
      };
    }) },
    options: baseOptions(asIndex ? (v) => (v == null ? "–" : Number(v).toFixed(0)) : eokLabel),
  });
  const r = RATIOS.find((x) => x.key === $("ratioSel").value);
  chart("ratioChart", {
    type: "bar",
    data: { labels: years, datasets: items.map((s) => ({
      label: s.name, backgroundColor: s.color, borderRadius: 4, data: years.map((y) => s.ratios[r.key][y] ?? null),
    })) },
    options: baseOptions((v) => fmt(v, r.unit)),
  });
}

// --- 수익성 분해 탭 (강의 4장)
function renderProfit() {
  const items = loaded();
  const { text, grid } = themeColors();
  chart("dupontChart", {
    type: "scatter",
    data: { datasets: items.map((s) => {
      const pts = s.fin.years.map((y) => ({ ...dupont(s.fin, y, state.basis), year: y }))
        .filter((p) => p.margin != null && p.turnover != null).map((p) => ({ x: p.turnover, y: p.margin, roa: p.roa, year: p.year }));
      return { label: s.name, data: pts, showLine: true, borderColor: s.color, backgroundColor: s.color, borderWidth: 1.5,
        pointRadius: pts.map((p) => (p.year === yearFor(s) ? 7 : 3)) };
    }) },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: text, boxWidth: 12 } },
        tooltip: { callbacks: { label: (ctx) => { const p = ctx.raw; return `${ctx.dataset.label} ${p.year}: 순이익률 ${p.y.toFixed(1)}% × 회전율 ${p.x.toFixed(2)}회 = ROA ${p.roa.toFixed(1)}%`; } } } },
      scales: {
        x: { title: { display: true, text: "총자산회전율 (회)", color: text }, ticks: { color: text }, grid: { color: grid } },
        y: { title: { display: true, text: "매출액순이익률 (%)", color: text }, ticks: { color: text, callback: (v) => `${v}%` }, grid: { color: grid } },
      },
    },
  });

  const f = focusItem();
  const fy = f && yearFor(f);
  const t = f && roeTree(f.fin, fy, state.basis);
  $("treeTitle").textContent = f ? `${f.name} ${fy}년` : "";
  $("roeTree").innerHTML = !t ? `<p class="muted">계산에 필요한 계정(차입금·자본 등)이 부족합니다.</p>` : `
    <div class="node root"><span class="k">ROE (연결실체)</span><span class="v">${fmt(t.roe, "%")}</span></div>
    <div class="branches">
      <div class="branch">
        <div class="node"><span class="k">ROIC (영업투하자본이익률)</span><span class="v">${fmt(t.roic, "%")}</span></div>
        <div class="leaves">
          <div class="leaf"><span class="k">세후순영업이익률</span><span class="v">${fmt(t.nopatMargin, "%")}</span></div>
          <div class="op">×</div>
          <div class="leaf"><span class="k">영업투하자본회전율</span><span class="v">${fmt(t.icTurnover, "회")}</span></div>
        </div>
      </div>
      <div class="op big">+</div>
      <div class="branch">
        <div class="node"><span class="k">재무레버리지효과</span><span class="v ${t.effect >= 0 ? "pos" : "neg"}">${fmt(t.effect, "%p")}</span></div>
        <div class="leaves">
          <div class="leaf"><span class="k">ROIC − 세후순차입이자율</span><span class="v">${fmt(t.roic, "%")} − ${fmt(t.r, "%")}</span></div>
          <div class="op">×</div>
          <div class="leaf"><span class="k">순재무부채 ÷ 자기자본</span><span class="v">${fmt(t.lev, "배")}</span></div>
        </div>
      </div>
    </div>
    <p class="muted small">세후 순영업이익 ${eokLabel(t.nopat / 1e8)} · 영업투하자본 ${eokLabel(t.ic / 1e8)} (순재무부채 ${eokLabel(t.nfd / 1e8)} + 자기자본 ${eokLabel(t.equity / 1e8)}) · 세율 ${(t.t * 100).toFixed(1)}%
    ${t.netCash ? "<br>순재무부채가 음수(순현금)라 세후순차입이자율은 해석에 주의하세요." : ""}
    ${t.effect < 0 ? "<br>빚을 낸 사업이 차입이자율보다 못 벌어 ROE를 깎고 있습니다 (호텔롯데 사례와 같은 유형)." : t.effect > 0 ? "<br>빚을 내 번 수익이 이자보다 커서 ROE를 높이고 있습니다 (호텔신라 사례와 같은 유형)." : ""}</p>`;

  const rows = [
    ["ROE (연결실체)", (x) => fmt(x.roe, "%")],
    ["ROIC", (x) => fmt(x.roic, "%")],
    ["  세후순영업이익률", (x) => fmt(x.nopatMargin, "%")],
    ["  영업투하자본회전율", (x) => fmt(x.icTurnover, "회")],
    ["세후 순차입이자율", (x) => fmt(x.r, "%")],
    ["순재무부채 ÷ 자기자본", (x) => fmt(x.lev, "배")],
    ["재무레버리지효과", (x) => fmt(x.effect, "%p")],
    ["순재무부채 (리스 포함)", (x) => eokLabel(x.nfd / 1e8)],
    ["영업투하자본", (x) => eokLabel(x.ic / 1e8)],
  ];
  const trees = items.map((s) => roeTree(s.fin, yearFor(s), state.basis));
  $("roeCompareNote").textContent = `잔액 기준: ${$("basis").selectedOptions[0].textContent}`;
  $("roeTable").innerHTML = `<thead><tr><th>항목</th>${headCells(items)}</tr></thead><tbody>${
    rows.map(([label, f]) => `<tr><td>${label.replace(/^ {2}/, "&nbsp;&nbsp;└ ")}</td>${trees.map((x) => `<td>${x ? f(x) : "–"}</td>`).join("")}</tr>`).join("")
  }</tbody>`;

  // 재무레버리지 시뮬레이터: 기업이나 연도가 바뀌면 그 회사 실제값으로 초기화
  $("simTitle").textContent = f ? `시작값: ${f.name} ${fy}년` : "";
  const key = f ? `${f.code}|${fy}|${state.basis}` : null;
  if (key !== simKey) {
    simKey = key;
    const clamp = (x, lo, hi, d) => (x == null || !Number.isFinite(x) ? d : Math.min(hi, Math.max(lo, x)));
    $("simRoic").value = clamp(t?.roic, -10, 25, 5);
    $("simR").value = clamp(t?.r, 0, 10, 3);
    $("simLev").value = clamp(t?.lev, 0, 3, 0.5);
  }
  drawSim();

  // 자기자본 증가 분해 (3장 5절)
  const egs = items.map((s) => equityGrowth(s.fin, yearFor(s)));
  const egRows = [
    ["기초 지배주주 자본", (x) => eokLabel(toEok(x.e0))],
    ["기말 지배주주 자본", (x) => eokLabel(toEok(x.e1))],
    ["자기자본 증가율", (x) => fmt(x.growthRate, "%")],
    ["= 지배기업 ROE (포괄이익, 기초)", (x) => fmt(x.roe, "%")],
    ["+ 주주의 순투자율", (x) => fmt(x.netInvest, "%")],
    ["+ 기타 (연결범위·자본거래 등)", (x) => fmt(x.other, "%")],
  ];
  $("egTable").innerHTML = `<thead><tr><th>항목</th>${headCells(items)}</tr></thead><tbody>${
    egRows.map(([label, g], i) => `<tr class="${i === 2 ? "strong" : ""}"><td>${label}</td>${egs.map((x) => `<td>${x ? g(x) : "–"}</td>`).join("")}</tr>`).join("")
  }</tbody>`;

  // 초과이익·EVA (4장 3절)
  $("rf").value = prefs.rf;
  $("mrp").value = prefs.mrp;
  const vcs = items.map((s) => valueCreation(s.fin, yearFor(s), { rf: prefs.rf, mrp: prefs.mrp, beta: prefs.beta[s.code] ?? 1 }));
  const verdict = (x) => (x == null ? "–" : x >= 0 ? `<span class="pos">가치 창출</span>` : `<span class="neg">가치 훼손</span>`);
  const vcRows = [
    ["자기자본비용 (CAPM)", (x) => fmt(x.re, "%")],
    ["ROE (포괄이익, 기초 자본)", (x) => fmt(x.roeBegin, "%")],
    ["초과이익", (x) => eokLabel(toEok(x.excess)), true],
    ["  판정", (x) => verdict(x.excess)],
    ["WACC", (x) => fmt(x.wacc, "%")],
    ["ROIC (기초 영업투하자본)", (x) => fmt(x.roicBegin, "%")],
    ["EVA", (x) => eokLabel(toEok(x.eva)), true],
    ["  판정", (x) => verdict(x.eva)],
  ];
  $("vcTable").innerHTML = `<thead><tr><th>항목</th>${headCells(items)}</tr></thead><tbody>
    <tr><td>베타</td>${items.map((s) => `<td><input class="cell-input" type="number" step="0.05" data-beta="${s.code}" value="${prefs.beta[s.code] ?? 1}" aria-label="${esc(s.name)} 베타" /></td>`).join("")}</tr>
    ${vcRows.map(([label, g, strong]) => `<tr class="${strong ? "strong" : ""}"><td>${label.replace(/^ {2}/, "&nbsp;&nbsp;└ ")}</td>${vcs.map((x) => `<td>${x ? g(x) : "–"}</td>`).join("")}</tr>`).join("")}
  </tbody>`;
}

let simKey = null;
function drawSim() {
  const roic = Number($("simRoic").value), r = Number($("simR").value), lev = Number($("simLev").value);
  const roe = roic + (roic - r) * lev;
  $("simRoicOut").textContent = `${roic.toFixed(1)}%`;
  $("simROut").textContent = `${r.toFixed(1)}%`;
  $("simLevOut").textContent = `${lev.toFixed(2)}배`;
  $("simResult").innerHTML = `ROE = ${roic.toFixed(1)}% + (${roic.toFixed(1)}% − ${r.toFixed(1)}%) × ${lev.toFixed(2)} = <strong>${roe.toFixed(1)}%</strong>
    <span class="${roic >= r ? "pos" : "neg"}">재무레버리지효과 ${fmt((roic - r) * lev, "%p")}</span>`;
  const xs = Array.from({ length: 31 }, (_, i) => i / 10);
  const line = xs.map((x) => ({ x, y: roic + (roic - r) * x }));
  const { accent, text, grid } = themeColors();
  if (charts.simChart) {
    charts.simChart.data.datasets[0].data = line;
    charts.simChart.data.datasets[1].data = [{ x: lev, y: roe }];
    charts.simChart.update("none");
    return;
  }
  chart("simChart", {
    type: "scatter",
    data: { datasets: [
      { label: "ROE (부채비율에 따라)", data: line, showLine: true, pointRadius: 0, borderColor: accent, borderWidth: 2 },
      { label: "현재 위치", data: [{ x: lev, y: roe }], pointRadius: 7, backgroundColor: accent },
    ] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { labels: { color: text, boxWidth: 12 } },
        tooltip: { callbacks: { label: (ctx) => `순재무부채/자기자본 ${ctx.parsed.x.toFixed(2)}배 → ROE ${ctx.parsed.y.toFixed(1)}%` } } },
      scales: {
        x: { title: { display: true, text: "순재무부채 ÷ 자기자본 (배)", color: text }, min: 0, max: 3, ticks: { color: text }, grid: { color: grid } },
        y: { title: { display: true, text: "ROE (%)", color: text }, ticks: { color: text, callback: (v) => `${v}%` }, grid: { color: grid } },
      },
    },
  });
}

// --- 손익 브리지 탭 (강의 5장)
function renderBridge() {
  const f = focusItem();
  if (!f) return;
  const fy = yearFor(f);
  const b = bridge(f.fin, fy);
  $("bridgeTitle").textContent = `${f.name} ${fy}년 · 단위 억원`;
  if (!b) { $("bridgeNote").innerHTML = `<p class="muted">영업이익 정보가 없습니다.</p>`; return; }
  waterfall("bridgeChart", b.items.map((i) => ({ ...i, value: i.value / 1e8 })));

  const worst = b.items.filter((i) => !i.total).sort((a, c) => a.value - c.value)[0];
  // 감사 정보는 최신 사업보고서의 당기·전기·전전기 3개 → 보고 있는 연도에 맞는 것
  const audit = f.gov?.audits?.[f.fin.latest_year - fy];
  const kam = audit?.keyMatters || [];
  const notes = [];
  if (b.operatingProfitButNetLoss) {
    notes.push(`<p class="warn-text">🚩 영업이익은 ${eokLabel(b.oi / 1e8)} 흑자인데 ${b.owners != null ? "지배주주 순이익" : "순이익"}은 ${eokLabel((b.owners ?? b.ni) / 1e8)}입니다.
      가장 크게 깎은 항목은 <strong>${esc(worst.label)} ${eokLabel(worst.value / 1e8)}</strong>입니다 — 주석에서 손상차손·처분손실 같은 일시적 항목인지 확인하세요.</p>`);
  }
  if (b.eps != null) {
    notes.push(`<p>주당순이익(EPS): <strong>${b.eps.toLocaleString("ko-KR")}원</strong> ${b.eps < 0 ? "→ <strong>PER 산출 불가(N/A)</strong>. 음수 PER은 표기하지 않습니다. 대신 아래 '기타손익 제외 순이익'(지속적 이익 근사)이나 PBR로 판단하세요." : "→ PER = 주가 ÷ EPS (주가는 DART에 없어 별도 확인 필요)"}</p>`);
  }
  notes.push(`<p>기타손익 제외 순이익(근사): <strong>${eokLabel(toEok(b.coreNi))}</strong> <span class="muted small">(기타수익−기타비용 ${eokLabel(toEok(b.otherNet))}을 일시적으로 보고 세후 제거)</span></p>`);
  if (kam.length) notes.push(`<p class="muted small">감사인이 꼽은 핵심감사사항(${esc(audit.period)}, ${fy}년): ${kam.map(esc).join(" / ")}</p>`);
  $("bridgeNote").innerHTML = notes.join("");

  const ys = f.fin.years;
  const per = ys.map((y) => bridge(f.fin, y));
  const v = (k, y) => f.fin.data[k]?.[y] ?? null;
  const rows = [
    ["영업이익", (y) => v("operatingIncome", y), true],
    ["+ 기타수익", (y) => v("otherIncome", y)],
    ["− 기타비용", (y) => v("otherExpense", y)],
    ["+ 금융수익", (y) => v("financeIncome", y)],
    ["− 금융비용", (y) => v("financeCosts", y)],
    ["± 지분법손익", (y) => v("equityMethod", y)],
    ["세전이익", (y) => v("pretaxIncome", y), true],
    ["− 법인세", (y) => v("incomeTax", y)],
    ["당기순이익", (y) => v("netIncome", y), true],
    ["지배주주 순이익", (y) => v("netIncomeOwners", y), true],
    ["기타손익 제외 순이익(근사)", (y, i) => per[i]?.coreNi ?? null],
    ["기타포괄손익", (y) => (v("comprehensiveIncome", y) == null || v("netIncome", y) == null ? null : v("comprehensiveIncome", y) - v("netIncome", y))],
    ["총포괄이익", (y) => v("comprehensiveIncome", y), true],
  ];
  $("bridgeTable").innerHTML = `<thead><tr><th>항목</th>${ys.map((y) => `<th>${y}</th>`).join("")}</tr></thead><tbody>${
    rows.filter(([, g]) => ys.some((y, i) => g(y, i) != null)).map(([label, g, strong]) =>
      `<tr class="${strong ? "strong" : ""}"><td>${label}</td>${ys.map((y, i) => { const x = g(y, i); return `<td class="${x < 0 ? "neg" : ""}">${eok(x)}</td>`; }).join("")}</tr>`).join("")
  }<tr><td>EPS (원)</td>${ys.map((y) => { const e = v("eps", y); return `<td class="${e < 0 ? "neg" : ""}">${e == null ? "–" : e.toLocaleString("ko-KR")}</td>`; }).join("")}</tr></tbody>`;

  const items = loaded();
  const bs = items.map((s) => bridge(s.fin, yearFor(s)));
  const crow = [
    ["영업이익", (b) => eokLabel(toEok(b.oi))],
    ["영업 밖 손익 (세전)", (b) => { const pre = b.items.find((i) => i.label === "세전이익"); return pre ? eokLabel(toEok(pre.value - b.oi)) : "–"; }],
    ["당기순이익", (b) => eokLabel(toEok(b.ni))],
    ["지배주주 순이익", (b) => eokLabel(toEok(b.owners))],
    ["기타손익 제외 순이익(근사)", (b) => eokLabel(toEok(b.coreNi))],
    ["EPS", (b) => (b.eps == null ? "–" : `${b.eps.toLocaleString("ko-KR")}원`)],
    ["PER", (b) => (b.eps == null ? "–" : b.eps < 0 ? "N/A (적자)" : "주가 필요")],
  ];
  $("bridgeCompareNote").textContent = "각 사 비교 연도 기준";
  $("bridgeCompare").innerHTML = `<thead><tr><th>항목</th>${headCells(items)}</tr></thead><tbody>${
    crow.map(([label, g]) => `<tr><td>${label}</td>${bs.map((b) => `<td>${b ? g(b) : "–"}</td>`).join("")}</tr>`).join("")
  }</tbody>`;

  // 기타포괄손익 구성 (5장)
  const oci = (f.fin.oci || []).filter((r) => ys.some((y) => r.values[y]));
  const biggest = oci.filter((r) => !r.total && !/법인세/.test(r.name)).sort((a, c) => Math.abs(c.values[fy] ?? 0) - Math.abs(a.values[fy] ?? 0))[0];
  $("ociNote").textContent = `${f.name} · 단위 억원${biggest?.values[fy] ? ` · ${fy}년 가장 큰 항목: ${biggest.name} ${eokLabel(toEok(biggest.values[fy]))}` : ""}`;
  $("ociTable").innerHTML = !oci.length ? `<tbody><tr><td class="muted">기타포괄손익 항목이 없습니다.</td></tr></tbody>` :
    `<thead><tr><th>항목</th>${ys.map((y) => `<th>${y}</th>`).join("")}</tr></thead><tbody>${
      oci.map((r) => `<tr class="${r.total ? "strong" : ""}"><td>${esc(r.name)}</td>${ys.map((y) => `<td class="${r === biggest && y === fy ? "hl" : ""}">${eok(r.values[y])}</td>`).join("")}</tr>`).join("")
    }<tr class="strong"><td>기타포괄손익 합계 (총포괄이익 − 당기순이익)</td>${ys.map((y) => { const ci = v("comprehensiveIncome", y), ni = v("netIncome", y); return `<td>${ci == null || ni == null ? "–" : eok(ci - ni)}</td>`; }).join("")}</tr></tbody>`;

  // 시장가치비율 (3장 7절)
  const vals = items.map((s) => valuation(s.fin, yearFor(s), prefs.price[s.code], s.gov?.shares?.outstanding));
  const perTxt = (x) => (x == null ? "N/A" : fmt(x, "배"));
  const vrows = [
    ["유통주식수 (보통주)", (s) => (s.gov?.shares?.outstanding ? `${s.gov.shares.outstanding.toLocaleString("ko-KR")}주` : s.gov ? "–" : "불러오는 중")],
    ["시가총액", (s, x) => (x ? eokLabel(toEok(x.mcap)) : "–")],
    ["EPS (공시)", (s, x) => (x?.eps == null ? "–" : `${x.eps.toLocaleString("ko-KR")}원`)],
    ["PER", (s, x) => (x ? perTxt(x.per) : "–")],
    ["정상화 EPS (기타손익 제외, 근사)", (s, x) => (x?.coreEps == null ? "–" : `${Math.round(x.coreEps).toLocaleString("ko-KR")}원`)],
    ["정상화 PER", (s, x) => (x ? perTxt(x.perCore) : "–")],
    ["PBR", (s, x) => (x ? fmt(x.pbr, "배") : "–")],
    ["PSR", (s, x) => (x ? fmt(x.psr, "배") : "–")],
    ["EV / 매출액", (s, x) => (x ? fmt(x.evSales, "배") : "–")],
  ];
  $("valTable").innerHTML = `<thead><tr><th>항목</th>${headCells(items)}</tr></thead><tbody>
    <tr><td>주가 (원)</td>${items.map((s) => `<td><input class="cell-input wide" type="number" step="100" min="0" data-price="${s.code}" value="${prefs.price[s.code] ?? ""}" placeholder="예: 150000" aria-label="${esc(s.name)} 주가" /></td>`).join("")}</tr>
    ${vrows.map(([label, g]) => `<tr><td>${label}</td>${items.map((s, i) => `<td>${g(s, vals[i])}</td>`).join("")}</tr>`).join("")}
  </tbody>`;
}

// --- 현금흐름 탭 (강의 6장)
function renderCash() {
  const f = focusItem();
  if (!f) return;
  const fy = yearFor(f);
  const c = cashFlow(f.fin, fy);
  $("fcfTitle").textContent = `${f.name} ${fy}년 · 단위 억원`;
  if (c) {
    const items = [
      { label: "영업활동현금흐름", value: c.ocf, total: true },
      ...(Math.abs(c.ocfCore - c.ocf) >= 0.5e8 ? [{ label: "이자 효과 제거", value: c.ocfCore - c.ocf }] : []),
      { label: "유·무형자산 순투자", value: -c.netCapex },
      { label: "기업 FCF", value: c.fcfFirm, total: true },
      ...c.uses.filter(([, x]) => Math.abs(x) >= 0.5e8).map(([label, x]) => ({ label, value: -x })),
      { label: "잔여 (금융자산·현금 증감 등)", value: c.rest, total: true },
    ];
    waterfall("fcfChart", items.map((i) => ({ ...i, value: i.value / 1e8 })));
  }

  const ys = f.fin.years;
  const per = Object.fromEntries(ys.map((y) => [y, cashFlow(f.fin, y)]));
  chart("qualityChart", {
    type: "line",
    data: { labels: ys, datasets: [
      { label: "당기순이익", data: ys.map((y) => toEok(f.fin.data.netIncome[y])), borderColor: "#8a94a6", backgroundColor: "#8a94a6", tension: 0.2 },
      { label: "영업활동현금흐름", data: ys.map((y) => toEok(per[y]?.ocf)), borderColor: f.color, backgroundColor: f.color, tension: 0.2 },
      { label: "기업 FCF", data: ys.map((y) => toEok(per[y]?.fcfFirm)), borderColor: f.color, backgroundColor: f.color, borderDash: [5, 4], tension: 0.2 },
    ] },
    options: baseOptions(eokLabel),
  });

  const rows = [
    ["영업활동현금흐름", (c) => eok(c.ocf), true],
    ["이자지급 분류", (c) => c.interestClass],
    ["이자 효과 제거 후 영업현금흐름", (c) => eok(c.ocfCore)],
    ["− 유·무형자산 순투자", (c) => eok(c.netCapex)],
    ["= 기업 FCF", (c) => eok(c.fcfFirm), true],
    ["− 리스부채 상환(리스료)", (c) => eok(c.lease)],
    ["= FCF (리스료 차감)", (c) => eok(c.fcfAfterLease), true],
    ["배당금 지급", (c) => eok(c.uses[3][1])],
    ["자기주식 취득", (c) => eok(c.uses[4][1])],
    ["차입금 순상환(−는 순조달)", (c) => eok(c.uses[2][1])],
    ["투자활동현금흐름 합계", (c) => eok(c.investing)],
    ["재무활동현금흐름 합계", (c) => eok(c.financing)],
    ["영업현금흐름 ÷ 순이익", (c) => (c.ni > 0 ? fmt(c.ocf / c.ni, "배") : "–")],
  ];
  $("cfSummaryNote").textContent = `${f.name} · 단위 억원`;
  $("cfSummary").innerHTML = `<thead><tr><th>항목</th>${ys.map((y) => `<th>${y}</th>`).join("")}</tr></thead><tbody>${
    rows.map(([label, g, strong]) => `<tr class="${strong ? "strong" : ""}"><td>${label}</td>${ys.map((y) => `<td>${per[y] ? g(per[y]) : "–"}</td>`).join("")}</tr>`).join("")
  }</tbody>`;

  const items = loaded();
  const cs = items.map((s) => cashFlow(s.fin, yearFor(s)));
  $("cfCompareNote").textContent = "각 사 비교 연도 기준 · 단위 억원";
  $("cfCompare").innerHTML = `<thead><tr><th>항목</th>${headCells(items)}</tr></thead><tbody>${
    rows.map(([label, g, strong]) => `<tr class="${strong ? "strong" : ""}"><td>${label}</td>${cs.map((c) => `<td>${c ? g(c) : "–"}</td>`).join("")}</tr>`).join("")
  }</tbody>`;

  // 현금흐름표 전체
  const order = [["operating", "영업활동"], ["investing", "투자활동"], ["financing", "재무활동"], ["other", "현금 증감"]];
  const cf = f.fin.cashFlow || [];
  $("cfFullTitle").textContent = `${f.name} · 단위 억원`;
  $("cfFull").innerHTML = `<thead><tr><th>계정</th>${ys.map((y) => `<th>${y}</th>`).join("")}</tr></thead><tbody>${
    order.map(([sec, label]) => {
      const rowsIn = cf.filter((r) => r.section === sec).sort((a, b) => Number(b.total) - Number(a.total));
      if (!rowsIn.length) return "";
      return `<tr class="group"><td colspan="${ys.length + 1}">${label}</td></tr>` + rowsIn.map((r) =>
        `<tr class="${r.total ? "strong" : ""}"><td>${esc(r.name)}</td>${ys.map((y) => `<td>${eok(r.values[y])}</td>`).join("")}</tr>`).join("");
    }).join("")
  }</tbody>`;
}

// --- 안정성·효율성 탭
function renderStability() {
  const items = loaded();
  const g = (s, k) => s.ratios[k][yearFor(s)] ?? null;
  $("cccNote").textContent = "각 사 비교 연도 · 단위 일";
  chart("cccChart", {
    type: "bar",
    data: {
      labels: items.map((s) => `${s.name} (${yearFor(s)})`),
      datasets: [
        { label: "재고 보유기간", data: items.map((s) => g(s, "invDays")), backgroundColor: "#7aa0e8" },
        { label: "매출채권 회수기간", data: items.map((s) => g(s, "arDays")), backgroundColor: "#9ad0b8" },
        { label: "매입채무 결제기간 (−)", data: items.map((s) => { const x = g(s, "apDays"); return x == null ? null : -x; }), backgroundColor: "#f0a58a" },
        { label: "현금전환주기", data: items.map((s) => g(s, "ccc")), backgroundColor: "#4a5568" },
      ],
    },
    options: { ...baseOptions((v) => fmt(v, "일")), interaction: { mode: "nearest", intersect: true } },
  });
  ratioTable("stabTable", ["활동성", "안정성"]);
}

// --- 지배구조·배당 탭
function renderGov() {
  $("govCards").innerHTML = state.selected.map((s) => {
    const g = s.gov;
    if (!g) return `<div class="card profile" style="--c:${s.color}"><h3>${esc(s.name)}</h3><p class="loading">불러오는 중…</p></div>`;
    if (g.error) return `<div class="card profile" style="--c:${s.color}"><h3>${esc(s.name)}</h3><p class="error">${esc(g.error)}</p></div>`;
    const pctTxt = (x) => (x == null ? "–" : `${x.toFixed(2)}%`);
    const h = g.holders, m = g.minority, e = g.executives, emp = g.employees;
    return `<div class="card profile gov" style="--c:${s.color}">
      <h3><span>${esc(s.name)}</span><span class="badge">${g.year} 사업보고서</span></h3>
      <h4>주주 구성</h4>
      <dl>
        <dt>최대주주+특수관계인</dt><dd><strong>${pctTxt(h?.total)}</strong></dd>
        <dt>소액주주 보유</dt><dd>${pctTxt(m?.shareRate)} ${m?.holders ? `<span class="muted small">(${m.holders.toLocaleString()}명)</span>` : ""}</dd>
      </dl>
      ${h?.top?.length ? `<ul class="mini">${h.top.map((x) => `<li>${esc(x.name)} <span class="muted">${esc(x.relation)}</span> <span>${pctTxt(x.rate)}</span></li>`).join("")}</ul>` : ""}
      <h4>이사회·임원</h4>
      <dl>
        <dt>임원</dt><dd>${e ? `${e.total}명 (등기 ${e.registered}명, 사외이사 ${e.outside}명)` : "–"}</dd>
        <dt>여성</dt><dd>${e ? `등기임원 ${e.femaleRegistered}명 · 전체 ${e.female}명` : "–"}</dd>
      </dl>
      <h4>배당</h4>
      ${g.dividends?.length ? `<table class="tbl mini-tbl"><thead><tr><th></th><th>당기</th><th>전기</th><th>전전기</th></tr></thead><tbody>${
        g.dividends.map((d) => `<tr><td>${esc(d.label)}</td>${d.values.map((x) => `<td>${x == null ? "–" : x.toLocaleString("ko-KR")}</td>`).join("")}</tr>`).join("")
      }</tbody></table>` : `<p class="muted small">배당 정보 없음</p>`}
      <h4>외부감사</h4>
      ${g.audits?.length ? g.audits.map((a) => `<div class="audit"><strong>${esc(a.period)}</strong> ${esc(a.auditor)} · <span class="${/적정/.test(a.opinion) ? "" : "warn-text"}">${esc(a.opinion)}</span>
        ${a.emphasis ? `<div class="small">강조사항: ${esc(a.emphasis)}</div>` : ""}
        ${a.keyMatters.length ? `<div class="small muted">핵심감사사항: ${a.keyMatters.map(esc).join(" / ")}</div>` : ""}</div>`).join("") : `<p class="muted small">감사 정보 없음</p>`}
      <h4>직원</h4>
      <dl>
        <dt>직원 수</dt><dd>${emp ? `${emp.count.toLocaleString()}명 (여성 ${emp.femaleRate?.toFixed(0)}%)` : "–"}</dd>
        <dt>평균 근속</dt><dd>${emp?.avgTenure ? `${emp.avgTenure.toFixed(1)}년` : "–"}</dd>
        <dt>1인 평균 급여</dt><dd>${emp?.avgSalary ? `${(emp.avgSalary / 1e6).toFixed(0)}백만원` : "–"}</dd>
      </dl>
    </div>`;
  }).join("") + `<p class="muted small gov-note">DART 정기보고서 주요정보(회사가 공시한 값)입니다. 직원 수는 사업보고서 제출 회사(별도) 기준입니다.</p>`;
}

// --- 재무제표 탭
function renderStatements() {
  const f = focusItem();
  if (!f) { $("stmtTable").innerHTML = ""; return; }
  const ys = f.fin.years;
  const rcepts = [...new Set(ys.map((y) => f.fin.sources?.[y]).filter(Boolean))];
  $("sourceLinks").innerHTML = `${esc(f.name)} ${f.fin.fs_div === "CFS" ? "연결" : "별도"} · 공시 원문: ${
    rcepts.map((r) => `<a href="https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${r}" target="_blank" rel="noopener">${ys.filter((y) => f.fin.sources[y] === r).join("·")}년 보고서</a>`).join(" · ")}`;
  const mode = $("stmtMode").value;
  const d = f.fin.data;
  const common = (fin, k, y) => { const base = fin.data[ROW_BASE[k]]?.[y]; const x = fin.data[k]?.[y]; return x == null || !base ? null : (x / base) * 100; };
  const cell = (k, y) => {
    if (mode === "common") return fmt(common(f.fin, k, y), "%");
    if (mode === "index") {
      const first = ys.map((yy) => d[k]?.[yy]).find((x) => x != null);
      const x = d[k]?.[y];
      return x == null || !(first > 0) ? "–" : ((x / first) * 100).toFixed(0);
    }
    return eok(d[k][y]);
  };
  const unitLabel = { amount: "억원", common: "%", index: `${ys[0]}=100` }[mode];
  $("stmtTable").innerHTML = `<thead><tr><th>계정 (${unitLabel})</th>${ys.map((y) => `<th>${y}</th>`).join("")}</tr></thead><tbody>${
    STATEMENT_ROWS.filter(([k]) => ys.some((y) => d[k]?.[y] != null))
      .map(([k, label]) => `<tr><td>${label}</td>${ys.map((y) => `<td>${cell(k, y)}</td>`).join("")}</tr>`).join("")
  }</tbody>`;

  // 공통형 기업 비교 (3장 6절)
  const items = loaded();
  $("commonCompare").innerHTML = `<thead><tr><th>계정 (%)</th>${headCells(items)}</tr></thead><tbody>${
    STATEMENT_ROWS.filter(([k]) => k !== "revenue" && k !== "totalAssets" && items.some((s) => s.fin.data[k]?.[yearFor(s)] != null))
      .map(([k, label]) => `<tr><td>${label} <span class="muted small">÷ ${ROW_BASE[k] === "revenue" ? "매출" : "총자산"}</span></td>${
        items.map((s) => `<td>${fmt(common(s.fin, k, yearFor(s)), "%")}</td>`).join("")}</tr>`).join("")
  }</tbody>`;
}

/** 표를 엑셀에서 열리는 CSV로 저장 (입력칸은 입력값으로) */
function downloadCsv(tableId) {
  const table = $(tableId);
  const rows = [...table.querySelectorAll("tr")].map((tr) => [...tr.children].map((td) => {
    const input = td.querySelector("input");
    const text = (input ? input.value : td.innerText).replace(/\s+/g, " ").trim();
    return `"${text.replace(/"/g, '""')}"`;
  }).join(","));
  const names = loaded().map((s) => s.name.replace(/[()㈜주식회사\s]/g, "")).join("_");
  const blob = new Blob(["﻿" + rows.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${names || "dart"}_${TAB_LABEL[state.tab]}_${tableId}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function printReport() {
  const items = loaded();
  $("printHead").textContent = `${TAB_LABEL[state.tab]} · ${items.map((s) => `${s.name} ${yearFor(s)}`).join(", ")} · ${state.fs === "CFS" ? "연결" : "별도"} · 잔액 기준 ${$("basis").selectedOptions[0].textContent} · 출력일 ${new Date().toLocaleDateString("ko-KR")}`;
  $("printUrl").textContent = location.href;
  window.print();
}

// ---------- 시작 ----------
function setupControls() {
  const thisYear = new Date().getFullYear();
  $("year").innerHTML = Array.from({ length: 8 }, (_, i) => thisYear - 1 - i).map((y) => `<option value="${y}">${y}</option>`).join("");
  $("ratioSel").innerHTML = RATIOS.map((r) => `<option value="${r.key}">${r.label}</option>`).join("");
  $("ratioSel").value = "opMargin";

  $("fs").addEventListener("change", (e) => { state.fs = e.target.value; reloadAll(); });
  $("year").addEventListener("change", (e) => { state.year = Number(e.target.value); state.focusYear = null; reloadAll(); });
  $("basis").addEventListener("change", (e) => {
    state.basis = e.target.value;
    loaded().forEach((s) => { s.ratios = computeRatios(s.fin, state.basis); });
    syncUrl();
    render();
  });
  $("metric").addEventListener("change", render);
  $("trendMode").addEventListener("change", render);
  $("ratioSel").addEventListener("change", render);
  $("stmtMode").addEventListener("change", render);
  for (const id of ["rf", "mrp"]) {
    $(id).addEventListener("change", (e) => { const x = parseFloat(e.target.value); if (Number.isFinite(x)) { prefs[id] = x; savePrefs(); } render(); });
  }
  // 표 안의 베타·주가 입력칸 (입력을 마치고 칸을 벗어나면 다시 계산)
  document.addEventListener("change", (e) => {
    const el = e.target;
    const kind = el.dataset?.beta ? "beta" : el.dataset?.price ? "price" : null;
    if (!kind) return;
    const code = el.dataset[kind];
    const x = parseFloat(el.value);
    if (Number.isFinite(x) && x > (kind === "price" ? 0 : -5)) prefs[kind][code] = x; else delete prefs[kind][code];
    savePrefs();
    render();
  });
  for (const id of ["simRoic", "simR", "simLev"]) $(id).addEventListener("input", drawSim);
  $("simReset").addEventListener("click", () => { simKey = null; render(); });
  $("printBtn").addEventListener("click", printReport);
  // 각 표 위에 CSV 저장 버튼
  document.querySelectorAll(".panel table.tbl[id]").forEach((t) => {
    const wrap = t.closest(".table-wrap");
    const bar = document.createElement("div");
    bar.className = "table-tools";
    bar.innerHTML = `<button type="button" data-csv="${t.id}" title="엑셀에서 열 수 있는 CSV로 저장">⬇ CSV</button>`;
    wrap.parentNode.insertBefore(bar, wrap);
  });
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-csv]"); if (b) downloadCsv(b.dataset.csv); });
  $("focus").addEventListener("change", (e) => { state.focus = e.target.value; render(); });
  $("focusYear").addEventListener("change", (e) => { state.focusYear = e.target.value ? Number(e.target.value) : null; render(); });
  document.querySelectorAll(".tabs [data-tab]").forEach((b) => b.addEventListener("click", () => { state.tab = b.dataset.tab; syncUrl(); render(); }));
  document.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => setCorps(b.dataset.preset.split(","))));
  document.addEventListener("click", (e) => {
    const rm = e.target.closest("[data-remove]"); if (rm) removeCorp(rm.dataset.remove);
    const add = e.target.closest("[data-add]"); if (add) addCorp(add.dataset.add);
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
}

async function init() {
  setupControls();
  setupSearch();
  await loadCorps();

  const p = new URLSearchParams(location.search);
  if (p.get("fs") === "OFS") state.fs = "OFS";
  const y = Number(p.get("y"));
  if (y >= 2015 && y < new Date().getFullYear()) state.year = y;
  if (["end", "begin"].includes(p.get("b"))) state.basis = p.get("b");
  if (TABS.includes(p.get("t"))) state.tab = p.get("t");
  $("fs").value = state.fs;
  $("year").value = String(state.year);
  $("basis").value = state.basis;

  const codes = (p.get("c") || DEFAULT_CORPS.join(",")).split(",").filter((c) => /^\d{8}$/.test(c)).slice(0, MAX);
  codes.forEach(addCorp);
  render();
}

init();
