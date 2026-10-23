import { industryName, isFinancial } from "./ksic.js";
import { RATIOS, computeRatios, formatRatio } from "./ratios.js";

const MAX = 4;
const COLORS = ["#2f6fed", "#e8743b", "#19a979", "#9b59b6"];
const DEFAULT_CORPS = ["00126380", "00164779"]; // 첫 방문 시 예시: 삼성전자, SK하이닉스

const STATEMENT_ROWS = [
  ["revenue", "매출액"], ["costOfSales", "매출원가"], ["grossProfit", "매출총이익"],
  ["operatingIncome", "영업이익"], ["netIncome", "당기순이익"], ["netIncomeOwners", "지배주주 순이익"],
  ["totalAssets", "자산총계"], ["currentAssets", "유동자산"], ["cash", "현금및현금성자산"], ["inventories", "재고자산"],
  ["totalLiabilities", "부채총계"], ["currentLiabilities", "유동부채"],
  ["totalEquity", "자본총계"], ["equityOwners", "지배주주 자본"],
  ["operatingCashFlow", "영업활동현금흐름"], ["capex", "유형자산 취득"],
];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const eok = (won) => (won == null ? "–" : Math.round(won / 1e8).toLocaleString("ko-KR"));
// 억원 단위 값을 1조 이상이면 "조"로 읽기 쉽게
const eokLabel = (v) => {
  if (v == null) return "–";
  const n = Number(v);
  return Math.abs(n) >= 10000 ? `${(n / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}조` : `${n.toLocaleString("ko-KR")}억`;
};

const state = {
  corps: [],          // [corp_code, corp_name, stock_code, induty_code]
  byCode: new Map(),
  selected: [],       // { code, name, color, company, fin, ratios, error, loading }
  fs: "CFS",
  year: new Date().getFullYear() - 1,
  focus: 0,
};
let trendChart, ratioChart;

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
  try {
    const [company, fin] = await Promise.all([
      item.company ? Promise.resolve(item.company) : api(`/api/company?corp_code=${item.code}`),
      api(`/api/financials?corp_code=${item.code}&fs=${state.fs}&year=${state.year}`),
    ]);
    item.company = company;
    item.name = company.corp_name;
    item.fin = fin;
    item.ratios = computeRatios(fin);
  } catch (e) {
    item.error = e.message;
    item.fin = null;
    item.ratios = null;
  }
  item.loading = false;
  render();
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
  state.focus = Math.min(state.focus, Math.max(0, state.selected.length - 1));
  syncUrl();
  render();
}

function reloadAll() {
  syncUrl();
  state.selected.forEach(loadCompany);
}

// 공유 가능한 링크: ?c=코드,코드&fs=CFS&y=2025
function syncUrl() {
  const p = new URLSearchParams();
  if (state.selected.length) p.set("c", state.selected.map((s) => s.code).join(","));
  p.set("fs", state.fs);
  p.set("y", state.year);
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

// ---------- 렌더링 ----------
function render() {
  const has = state.selected.length > 0;
  $("empty").hidden = has;
  $("results").hidden = !has;

  $("chips").innerHTML = state.selected.map((s) =>
    `<span class="chip"><span class="dot" style="background:${s.color}"></span>${esc(s.name)}${s.loading ? " …" : ""}
      <button data-remove="${s.code}" aria-label="${esc(s.name)} 제거">×</button></span>`).join("");

  if (!has) return;
  renderProfiles();
  renderRatioTable();
  renderCharts();
  renderStatement();
}

function peersOf(company) {
  if (!company?.induty_code) return [];
  return state.corps.filter((c) => c[3] === company.induty_code && c[0] !== company.corp_code).slice(0, 6);
}

function renderProfiles() {
  $("profiles").innerHTML = state.selected.map((s) => {
    const c = s.company;
    if (!c) return `<div class="card profile" style="--c:${s.color}"><h3>${esc(s.name)}</h3>
      ${s.error ? `<p class="error">${esc(s.error)}</p>` : `<p class="loading">불러오는 중…</p>`}</div>`;
    const ind = industryName(c.induty_code);
    const peers = peersOf(c);
    const hasIndustryData = state.corps.some((x) => x[3]);
    const est = c.est_dt ? `${c.est_dt.slice(0, 4)}.${c.est_dt.slice(4, 6)}.${c.est_dt.slice(6, 8)}` : "–";
    const home = c.homepage ? (c.homepage.startsWith("http") ? c.homepage : `http://${c.homepage}`) : null;
    return `<div class="card profile" style="--c:${s.color}">
      <h3><span>${esc(c.corp_name)}</span><span class="badge">${esc(c.market)} ${esc(c.stock_code)}</span></h3>
      <div class="industry">
        <strong>${esc(ind.minor || ind.major)}</strong>
        <span class="muted small">${ind.minor ? esc(ind.major) + " · " : ""}KSIC ${esc(c.induty_code)}</span>
      </div>
      <dl>
        <dt>대표자</dt><dd>${esc(c.ceo)}</dd>
        <dt>설립일</dt><dd>${est}</dd>
        <dt>결산월</dt><dd>${esc(c.acc_mt)}월</dd>
        ${home ? `<dt>홈페이지</dt><dd><a href="${esc(home)}" target="_blank" rel="noopener">${esc(c.homepage)}</a></dd>` : ""}
      </dl>
      ${s.error ? `<p class="error">${esc(s.error)}</p>` : ""}
      ${s.fin ? `<p class="muted small">${s.fin.fs_div === "CFS" ? "연결" : "별도"} · ${s.fin.years[0]}~${s.fin.latest_year}년${s.fin.fs_div !== state.fs ? " (연결 없음 → 별도 사용)" : ""}</p>` : ""}
      ${isFinancial(c.induty_code) ? `<p class="muted small">금융업은 매출·영업이익 구조가 달라 일부 비율이 비어 있을 수 있습니다.</p>` : ""}
      <div class="muted small">동종 업종 상장사</div>
      <div class="peers">${peers.length
        ? peers.map((p) => `<button data-add="${p[0]}">+ ${esc(p[1])}</button>`).join("")
        : `<span class="muted small">${hasIndustryData ? "없음" : "업종 데이터 수집 후 표시"}</span>`}</div>
    </div>`;
  }).join("");
}

function loaded() { return state.selected.filter((s) => s.fin && s.ratios); }

function renderRatioTable() {
  const items = loaded();
  if (!items.length) { $("ratioTable").innerHTML = ""; $("ratioYear").textContent = ""; return; }
  $("ratioYear").textContent = `각 기업 최신 사업연도 기준 (${[...new Set(items.map((s) => s.fin.latest_year))].join(", ")}년)`;

  let html = `<thead><tr><th>지표</th>${items.map((s) => `<th style="color:${s.color}">${esc(s.name)}</th>`).join("")}</tr></thead><tbody>`;
  let group = "";
  for (const r of RATIOS) {
    if (r.group !== group) { group = r.group; html += `<tr class="group"><td colspan="${items.length + 1}">${group}</td></tr>`; }
    const vals = items.map((s) => s.ratios[r.key][s.fin.latest_year]);
    const valid = vals.filter((v) => v != null && Number.isFinite(v));
    const best = items.length > 1 && valid.length > 1 ? (r.better === "high" ? Math.max(...valid) : Math.min(...valid)) : null;
    html += `<tr><td>${r.label}</td>${vals.map((v) => `<td class="${v === best ? "best" : ""}">${formatRatio(v, r.unit)}</td>`).join("")}</tr>`;
  }
  $("ratioTable").innerHTML = html + "</tbody>";
}

function chartColors() {
  const cs = getComputedStyle(document.documentElement);
  return { text: cs.getPropertyValue("--muted").trim(), grid: cs.getPropertyValue("--border").trim() };
}

function baseOptions(yFormat) {
  const { text, grid } = chartColors();
  return {
    responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
    plugins: { legend: { labels: { color: text, boxWidth: 12 } },
      tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${yFormat(ctx.parsed.y)}` } } },
    scales: {
      x: { ticks: { color: text }, grid: { color: grid } },
      y: { ticks: { color: text, callback: (v) => yFormat(v) }, grid: { color: grid } },
    },
  };
}

function renderCharts() {
  if (!window.Chart) return;
  const items = loaded();
  const years = [...new Set(items.flatMap((s) => s.fin.years))].sort();

  const metric = $("metric").value;
  const trendData = {
    labels: years,
    datasets: items.map((s) => ({
      label: s.name, borderColor: s.color, backgroundColor: s.color, tension: 0.25, spanGaps: true,
      data: years.map((y) => { const v = s.fin.data[metric]?.[y]; return v == null ? null : Math.round(v / 1e8); }),
    })),
  };
  trendChart?.destroy();
  trendChart = new Chart($("trendChart"), { type: "line", data: trendData, options: baseOptions(eokLabel) });

  const r = RATIOS.find((x) => x.key === $("ratioSel").value);
  const ratioData = {
    labels: years,
    datasets: items.map((s) => ({
      label: s.name, backgroundColor: s.color, borderRadius: 4,
      data: years.map((y) => s.ratios[r.key][y] ?? null),
    })),
  };
  ratioChart?.destroy();
  ratioChart = new Chart($("ratioChart"), { type: "bar", data: ratioData, options: baseOptions((v) => formatRatio(v, r.unit)) });
}

function renderStatement() {
  const items = loaded();
  const sel = $("focus");
  sel.innerHTML = items.map((s, i) => `<option value="${i}">${esc(s.name)}</option>`).join("");
  if (!items.length) { $("stmtTable").innerHTML = ""; return; }
  state.focus = Math.min(state.focus, items.length - 1);
  sel.value = String(state.focus);
  const s = items[state.focus];
  const ys = s.fin.years;
  $("stmtTable").innerHTML = `<thead><tr><th>계정 (억원)</th>${ys.map((y) => `<th>${y}</th>`).join("")}</tr></thead><tbody>${
    STATEMENT_ROWS.filter(([k]) => ys.some((y) => s.fin.data[k]?.[y] != null))
      .map(([k, label]) => `<tr><td>${label}</td>${ys.map((y) => `<td>${eok(s.fin.data[k][y])}</td>`).join("")}</tr>`).join("")
  }</tbody>`;
}

// ---------- 시작 ----------
function setupControls() {
  const thisYear = new Date().getFullYear();
  $("year").innerHTML = Array.from({ length: 8 }, (_, i) => thisYear - 1 - i).map((y) => `<option value="${y}">${y}</option>`).join("");
  $("ratioSel").innerHTML = RATIOS.map((r) => `<option value="${r.key}">${r.label}</option>`).join("");
  $("ratioSel").value = "opMargin";

  $("fs").addEventListener("change", (e) => { state.fs = e.target.value; reloadAll(); });
  $("year").addEventListener("change", (e) => { state.year = Number(e.target.value); reloadAll(); });
  $("metric").addEventListener("change", renderCharts);
  $("ratioSel").addEventListener("change", renderCharts);
  $("focus").addEventListener("change", (e) => { state.focus = Number(e.target.value); renderStatement(); });
  document.addEventListener("click", (e) => {
    const rm = e.target.closest("[data-remove]"); if (rm) removeCorp(rm.dataset.remove);
    const add = e.target.closest("[data-add]"); if (add) addCorp(add.dataset.add);
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderCharts);
}

async function init() {
  setupControls();
  setupSearch();
  await loadCorps();

  const p = new URLSearchParams(location.search);
  if (p.get("fs") === "OFS") state.fs = "OFS";
  const y = Number(p.get("y"));
  if (y >= 2015 && y < new Date().getFullYear()) state.year = y;
  $("fs").value = state.fs;
  $("year").value = String(state.year);

  const codes = (p.get("c") || DEFAULT_CORPS.join(",")).split(",").filter((c) => /^\d{8}$/.test(c)).slice(0, MAX);
  codes.forEach(addCorp);
  render();
}

init();
