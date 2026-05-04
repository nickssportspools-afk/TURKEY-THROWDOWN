/**
 * Turkey Throwdown — Apps Script bridge.
 *
 * This script lives INSIDE your Google Sheet (Extensions → Apps Script).
 * After deploying it as a Web App, the Turkey Throwdown website can POST
 * final scores to it; the script writes them into the Games tab and the
 * leaderboard updates automatically.
 *
 * Setup (one-time):
 *   1. Open your Sheet → Extensions → Apps Script.
 *   2. Replace whatever's in Code.gs with this whole file.
 *   3. Set ADMIN_KEY below to a secret string of your choice (long & random).
 *   4. Click "Deploy" → "New deployment".
 *      - Type: Web app
 *      - Description: Turkey Throwdown score writer
 *      - Execute as: Me (your Google account)
 *      - Who has access: Anyone
 *      - Click Deploy. Authorize when prompted.
 *   5. Copy the resulting "Web app URL" (ends in /exec).
 *   6. Paste that URL into the SCRIPT_URL constant in index.html.
 *   7. Paste ADMIN_KEY into the Admin tab on the website.
 */

// ---- CONFIG ---------------------------------------------------------------
const ADMIN_KEY  = "CHANGE_ME_TO_A_LONG_RANDOM_STRING";   // <-- pick something only you know
const GAMES_TAB  = "Games";
const FIRST_GAME_ROW = 5;          // first game row on the Games tab
const FAV_SCORE_COL  = 8;          // column H
const DOG_SCORE_COL  = 9;          // column I
// ---------------------------------------------------------------------------

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || "{}");
    if (body.key !== ADMIN_KEY) return jsonOut({ ok: false, error: "Bad admin key" });

    const gnum = parseInt(body.gameNum, 10);
    if (!gnum || gnum < 1 || gnum > 25) return jsonOut({ ok: false, error: "Bad gameNum" });
    const favScore = Number(body.favScore);
    const dogScore = Number(body.dogScore);
    if (!Number.isFinite(favScore) || !Number.isFinite(dogScore)) {
      return jsonOut({ ok: false, error: "Scores must be numbers" });
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(GAMES_TAB);
    if (!sheet) return jsonOut({ ok: false, error: "Games tab not found" });

    const row = FIRST_GAME_ROW + (gnum - 1);
    sheet.getRange(row, FAV_SCORE_COL).setValue(favScore);
    sheet.getRange(row, DOG_SCORE_COL).setValue(dogScore);

    return jsonOut({ ok: true, gameNum: gnum, favScore, dogScore });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

// Used to confirm the deployment is live; visit /exec in browser.
function doGet() {
  return jsonOut({ ok: true, msg: "Turkey Throwdown bridge is live. POST to write scores." });
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
