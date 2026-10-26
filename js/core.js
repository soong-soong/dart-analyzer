// 공통 도구: 계정 값 꺼내기, 평균/기초/기말 기준 잔액, 실효세율, 숫자 포맷

export const BASIS_LABEL = { avg: "평균(기초·기말)", end: "기말", begin: "기초" };

/**
 * @param fin   /api/financials 응답
 * @param basis "avg" | "end" | "begin" — 재무상태표 잔액을 분모로 쓸 때의 기준 (강의 4장: 평균·기초·기말 통일)
 */
export function helpers(fin, basis = "avg") {
  const d = fin.data;
  const v = (k, y) => d[k]?.[y] ?? null;
  const has = (y) => fin.years.includes(y);
  // 계산으로 만든 잔액(영업운전자본 등)에도 같은 기준을 적용
  const balOf = (fn, y) => {
    const cur = fn(y);
    const prev = has(y - 1) ? fn(y - 1) : null;
    if (basis === "end") return cur;
    if (basis === "begin") return prev;
    if (cur == null) return null;
    return prev == null ? cur : (cur + prev) / 2;
  };
  const bal = (k, y) => balOf((yy) => v(k, yy), y);
  // 실효세율 = 법인세비용 / 세전이익. 적자·이상치면 강의 예시의 24.2% 사용
  const taxRate = (y) => {
    const pt = v("pretaxIncome", y), tx = v("incomeTax", y);
    if (pt > 0 && tx != null) {
      const t = tx / pt;
      if (t >= 0 && t <= 0.5) return t;
    }
    return 0.242;
  };
  return { v, bal, balOf, has, taxRate };
}

export const div = (a, b) => (a == null || b == null || b === 0 ? null : a / b);
export const pct = (a, b) => { const r = div(a, b); return r == null ? null : r * 100; };
export const growth = (cur, prev) => (cur == null || prev == null || prev <= 0 ? null : ((cur - prev) / prev) * 100);
export const sum = (...xs) => (xs.every((x) => x == null) ? null : xs.reduce((s, x) => s + (x ?? 0), 0));

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** 원 → "1,234" (억원) */
export const eok = (won) => (won == null ? "–" : Math.round(won / 1e8).toLocaleString("ko-KR"));

/** 억원 단위 값을 1조 이상이면 "조"로 */
export const eokLabel = (v) => {
  if (v == null || !Number.isFinite(Number(v))) return "–";
  const n = Number(v);
  return Math.abs(n) >= 10000 ? `${(n / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}조` : `${Math.round(n).toLocaleString("ko-KR")}억`;
};

export function fmt(value, unit) {
  if (value == null || !Number.isFinite(value)) return "–";
  if (unit === "%") return `${value.toFixed(1)}%`;
  if (unit === "%p") return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%p`;
  if (unit === "회") return `${value.toFixed(2)}회`;
  if (unit === "배") return `${value.toFixed(2)}배`;
  if (unit === "일") return `${Math.round(value).toLocaleString("ko-KR")}일`;
  if (unit === "억원") return eokLabel(value);
  if (unit === "원") return `${Math.round(value).toLocaleString("ko-KR")}원`;
  return String(value);
}
