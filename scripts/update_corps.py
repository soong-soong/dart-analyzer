"""상장사 목록(data/corps.json)을 DART에서 내려받아 갱신한다.

- corpCode.xml(zip)에서 종목코드가 있는 기업만 남긴다.
- --with-industry: 기업 개황(company.json)으로 업종코드(KSIC)를 붙인다.
  이미 파일에 있는 업종코드는 재사용하므로 두 번째 실행부터는 신규 상장사만 조회한다.

표준 라이브러리만 사용 → GitHub Actions에서 pip 설치 없이 실행된다.
    DART_API_KEY=... python scripts/update_corps.py --with-industry
"""
import argparse
import io
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from datetime import date
from pathlib import Path

BASE = "https://opendart.fss.or.kr/api"
OUT = Path(__file__).resolve().parent.parent / "data" / "corps.json"


def get(path: str, **params) -> bytes:
    params["crtfc_key"] = os.environ["DART_API_KEY"]
    url = f"{BASE}/{path}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()


def listed_corps() -> list[dict]:
    raw = get("corpCode.xml")
    if not raw.startswith(b"PK"):  # 오류면 zip 대신 XML/JSON 메시지가 온다
        sys.exit(f"corpCode 다운로드 실패: {raw[:300]!r}")
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        root = ET.fromstring(z.read(z.namelist()[0]))
    corps = []
    for el in root.iter("list"):
        stock = (el.findtext("stock_code") or "").strip()
        if stock:
            corps.append({
                "corp_code": el.findtext("corp_code").strip(),
                "corp_name": el.findtext("corp_name").strip(),
                "stock_code": stock,
            })
    return corps


def load_existing_industry() -> dict[str, tuple[str, str]]:
    if not OUT.exists():
        return {}
    rows = json.loads(OUT.read_text(encoding="utf-8")).get("corps", [])
    # 법인구분(corp_cls)까지 저장된 행만 재사용 → 예전 형식 파일이면 한 번 전체를 다시 조회
    return {r[0]: (r[3], r[4]) for r in rows if len(r) > 4 and r[3] and r[4]}


def fetch_info(corp_code: str) -> tuple[str, str]:
    """업종코드와 법인구분(Y 유가증권, K 코스닥, N 코넥스, E 기타=상장폐지·합병된 옛 법인 등)"""
    body = json.loads(get("company.json", corp_code=corp_code))
    if body.get("status") == "020":
        raise RuntimeError("DART 일일 한도 초과")
    return body.get("induty_code") or "", body.get("corp_cls") or ""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--with-industry", action="store_true")
    ap.add_argument("--max-new", type=int, default=5000, help="이번 실행에서 업종을 새로 조회할 최대 기업 수")
    ap.add_argument("--delay", type=float, default=0.15, help="요청 간 대기(초)")
    args = ap.parse_args()

    corps = listed_corps()
    print(f"상장사 {len(corps)}곳")

    info = load_existing_industry()
    if args.with_industry:
        todo = [c for c in corps if c["corp_code"] not in info][: args.max_new]
        print(f"업종코드·법인구분 신규 조회 {len(todo)}곳")
        for i, c in enumerate(todo, 1):
            try:
                info[c["corp_code"]] = fetch_info(c["corp_code"])
            except RuntimeError as e:
                print(f"중단: {e} (다음 실행에서 이어서 조회)")
                break
            except Exception as e:  # 개별 실패는 건너뛴다
                print(f"  {c['corp_name']}: {e}")
            if i % 200 == 0:
                print(f"  {i}/{len(todo)}")
            time.sleep(args.delay)

    # 법인구분 E(기타)는 상장폐지·합병된 옛 법인이라 재무제표가 없다 → 목록에서 제외
    # (같은 이름의 현재 상장사와 겹쳐 검색 시 혼동을 일으킴. 예: SK 003600 vs 034730)
    rows = sorted(
        ([c["corp_code"], c["corp_name"], c["stock_code"], *info.get(c["corp_code"], ("", ""))] for c in corps
         if info.get(c["corp_code"], ("", ""))[1] != "E"),
        key=lambda r: r[1],
    )
    print(f"옛 법인(E) 제외 후 {len(rows)}곳")
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(
        json.dumps({"updated": date.today().isoformat(), "fields": ["corp_code", "corp_name", "stock_code", "induty_code", "corp_cls"], "corps": rows},
                   ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"저장: {OUT}")


if __name__ == "__main__":
    main()
