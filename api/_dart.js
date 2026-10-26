// DART Open API 공통 헬퍼. 파일명이 _로 시작하면 Vercel이 API 라우트로 노출하지 않는다.
const BASE = "https://opendart.fss.or.kr/api";

const DART_STATUS = {
  "010": "등록되지 않은 API 키입니다.",
  "011": "사용할 수 없는 API 키입니다.",
  "013": "조회된 데이터가 없습니다.",
  "020": "DART 일일 요청 한도를 초과했습니다. 내일 다시 시도해 주세요.",
  "100": "요청 값이 올바르지 않습니다.",
  "800": "DART 시스템 점검 중입니다.",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function dart(path, params) {
  const key = process.env.DART_API_KEY;
  if (!key) throw new HttpError(500, "서버에 DART_API_KEY 환경변수가 설정되지 않았습니다.");

  const url = new URL(`${BASE}/${path}`);
  url.searchParams.set("crtfc_key", key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const r = await fetch(url);
  if (!r.ok) throw new HttpError(502, `DART 서버 응답 오류 (HTTP ${r.status})`);
  const body = await r.json();
  if (body.status === "000" || body.status === "013") return body;
  throw new HttpError(502, DART_STATUS[body.status] || `DART 오류 ${body.status}: ${body.message}`);
}

function isCorpCode(v) {
  return typeof v === "string" && /^\d{8}$/.test(v);
}

// 같은 요청은 CDN에서 하루 캐시 → DART 호출 수와 응답 속도 모두 절약
function send(res, status, data, cacheSeconds = 0) {
  if (cacheSeconds > 0) {
    // 브라우저는 매번 확인(max-age=0), CDN만 하루 보관 → 새 배포 후 옛 응답이 브라우저에 남지 않음
    res.setHeader("Cache-Control", `public, max-age=0, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds}`);
  }
  res.status(status).json(data);
}

function handleError(res, err) {
  const status = err instanceof HttpError ? err.status : 500;
  send(res, status, { error: err.message || "알 수 없는 오류" });
}

module.exports = { dart, isCorpCode, send, handleError, HttpError };
