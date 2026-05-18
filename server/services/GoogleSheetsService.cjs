'use strict';

const { google } = require('googleapis');

const SHEET_NAME = '仕入れ中';
const RANGE = `${SHEET_NAME}!A:E`;

/**
 * A列の日付文字列（yyyy/mm/dd or yyyy-mm-dd）をDateに変換
 */
function parseDate(str) {
  if (!str) return null;
  const s = str.trim().replace(/\//g, '-');
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * 今日から N 日以内かどうか判定（JST基準）
 */
function isWithinDays(date, days) {
  if (!date) return false;
  const now = new Date();
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return date >= cutoff;
}

async function _getSheetClient() {
  const credPath = process.env.GOOGLE_SHEETS_CREDENTIALS_PATH;
  if (!credPath) throw new Error('GOOGLE_SHEETS_CREDENTIALS_PATH が未設定です');

  const auth = new google.auth.GoogleAuth({
    keyFile: credPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

/**
 * @param {string} itemCode - CROSSMALL の item_code
 * @returns {{ purchasingCount: number, purchaseHistory: number }}
 */
async function getPurchaseData(itemCode) {
  try {
    const spreadsheetId = process.env.PURCHASE_SHEET_ID;
    if (!spreadsheetId) throw new Error('PURCHASE_SHEET_ID が未設定です');

    const sheets = await _getSheetClient();
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: RANGE });
    const rows = res.data.values || [];

    // ヘッダー行があれば除外（A1が「登録日」等の文字列の場合）
    const dataRows = rows.filter(row => {
      const a = (row[0] || '').trim();
      return a && !isNaN(parseDate(a));
    });

    let purchasingCount = 0;
    let purchaseHistory = 0;

    for (const row of dataRows) {
      const dateStr  = (row[0] || '').trim();
      const code     = (row[1] || '').trim();
      const countRaw = (row[4] || '').toString().trim(); // E列 (index 4)

      if (code !== itemCode) continue;

      purchaseHistory++;

      const date = parseDate(dateStr);
      if (isWithinDays(date, 14)) {
        purchasingCount += parseInt(countRaw, 10) || 0;
      }
    }

    console.log(`[GoogleSheets] ${itemCode}: 仕入中=${purchasingCount}個, 実績=${purchaseHistory}回`);
    return { purchasingCount, purchaseHistory };

  } catch (err) {
    console.error(`[GoogleSheets] エラー (${itemCode}): ${err.message}`);
    return { purchasingCount: 0, purchaseHistory: 0 };
  }
}

module.exports = { getPurchaseData };
