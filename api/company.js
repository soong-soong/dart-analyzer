// GET /api/company?corp_code=00126380 → 기업 개황 (업종코드 포함)
const { dart, isCorpCode, send, handleError, HttpError } = require("./_dart");

const MARKET = { Y: "유가증권", K: "코스닥", N: "코넥스", E: "기타" };

module.exports = async (req, res) => {
  try {
    const { corp_code } = req.query;
    if (!isCorpCode(corp_code)) throw new HttpError(400, "corp_code는 8자리 숫자여야 합니다.");

    const c = await dart("company.json", { corp_code });
    if (c.status === "013") throw new HttpError(404, "기업 정보를 찾을 수 없습니다.");

    send(res, 200, {
      corp_code: c.corp_code,
      corp_name: c.corp_name,
      corp_name_eng: c.corp_name_eng,
      stock_code: c.stock_code,
      market: MARKET[c.corp_cls] || c.corp_cls,
      ceo: c.ceo_nm,
      induty_code: c.induty_code,
      est_dt: c.est_dt,
      acc_mt: c.acc_mt,
      homepage: c.hm_url,
      address: c.adres,
    }, 86400);
  } catch (err) {
    handleError(res, err);
  }
};
