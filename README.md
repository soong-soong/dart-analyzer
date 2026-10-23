# DART 재무 비교

금융감독원 **DART Open API**로 상장사 사업보고서 재무제표를 불러와, 최대 4개 기업의 재무비율·추이를 비교하는 웹앱입니다.

- 기업명/종목코드 검색 (전체 상장사)
- 기업 개요 + **업종(KSIC) 표시**, 같은 업종 상장사 추천 → 클릭 한 번으로 비교 추가
- 재무비율 12종 비교표 (성장성·수익성·안정성·활동성·현금흐름), 기업별 최고값 강조
- 매출/이익/자산 등 최대 6개년 추이 차트, 비율 추이 차트 (Chart.js)
- 연결/별도 전환, 기준 사업연도 선택, `?c=00126380,00164779` 형태의 공유 링크

## 구조

```
index.html, style.css, js/        정적 프런트엔드 (빌드 없음, 바닐라 JS + Chart.js)
api/company.js                    기업 개황 프록시  → DART company.json
api/financials.js                 재무제표 프록시   → DART fnlttSinglAcntAll.json (사업보고서, 2회 호출로 6개년)
data/corps.json                   상장사 목록 + 업종코드 (GitHub Actions가 매월 갱신)
scripts/update_corps.py           corps.json 생성 스크립트 (파이썬 표준 라이브러리만 사용)
```

**왜 서버 함수가 필요한가?** DART API는 브라우저에서 직접 호출할 수 없고(CORS), API 키가 노출되면 안 됩니다.
그래서 Vercel 서버리스 함수가 키를 숨긴 채 대신 호출하고, 응답을 CDN에 하루 캐시해 DART 호출 수(일 20,000회 한도)를 아낍니다.

## 배포 (로컬 설치 없이)

1. [DART Open API](https://opendart.fss.or.kr)에서 인증키 발급
2. 이 폴더를 GitHub 저장소로 올리기
3. 저장소 **Settings → Secrets and variables → Actions** 에 `DART_API_KEY` 추가
4. **Actions → Update corp list → Run workflow** 실행 (전체 상장사 + 업종코드 수집, 첫 실행 15분 내외)
5. [Vercel](https://vercel.com)에서 저장소 Import → **Environment Variables**에 `DART_API_KEY` 추가 → Deploy

이후 `main`에 push할 때마다 자동 재배포됩니다.

## 로컬 실행 (선택)

Node.js 18+ 만 있으면 됩니다 (패키지 설치 없음). `.env` 파일에 `DART_API_KEY=...` 를 넣고:

```bash
node dev-server.js
```

→ http://localhost:3000 . `.env`는 `.gitignore`에 있어 GitHub에 올라가지 않습니다.

## 계산식

| 지표 | 식 |
|---|---|
| ROE | 지배주주 순이익 ÷ 평균 지배주주 자본 (별도는 순이익 ÷ 평균 자본) |
| ROA | 순이익 ÷ 평균 총자산 |
| 부채비율 | 부채총계 ÷ 자본총계 |
| 유동비율 | 유동자산 ÷ 유동부채 |
| 총자산회전율 | 매출액 ÷ 평균 총자산 |
| FCF | 영업활동현금흐름 − 유형자산 취득 |

평균은 전년도 값이 있을 때만 쓰고, 없으면 기말값을 씁니다.

## 한계

- 계정 매칭은 IFRS 태그 우선, 없으면 계정명으로 찾습니다. 일부 기업은 계정명이 달라 빈칸이 나올 수 있습니다.
- 금융업(은행·보험·증권)은 손익 구조가 달라 매출 기반 비율이 비어 있습니다.
- 주가 데이터가 없어 PER·PBR 같은 밸류에이션 지표는 제외했습니다.
