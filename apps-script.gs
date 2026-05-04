/**
 * Turkey Throwdown — Apps Script bridge.
 *
 * Lives INSIDE your Google Sheet (Extensions → Apps Script).
 * Two jobs:
 *   1) Admin score writer — the website's Admin tab POSTs final scores here
 *      (doPost). Used when you type scores manually on the website.
 *   2) Auto-fetcher — fetchAndUpdateScores() pulls finals from ESPN's free
 *      API and writes them to the Games tab. Set up as a time-based trigger
 *      to run every 15 minutes. Manual entries always win — auto-fetch
 *      skips any game where score columns are already filled.
 *
 * One-time setup:
 *   1.  Open your Sheet → Extensions → Apps Script.
 *   2.  Replace whatever's in Code.gs with this whole file.
 *   3.  Set ADMIN_KEY below to a long random string only you know.
 *   4.  Click Save (💾) or Cmd-S.
 *   5.  Click Deploy → New deployment.
 *         - gear icon → Web app
 *         - Execute as: Me
 *         - Who has access: Anyone
 *         - Deploy. Authorize when prompted.
 *   6.  Copy the resulting Web app URL (ends in /exec).
 *   7.  Paste that URL into the SCRIPT_URL constant in your site's index.html.
 *   8.  Set up the auto-fetch schedule:
 *         - In Apps Script, click the alarm-clock icon (Triggers) in the left rail.
 *         - "+ Add Trigger" (bottom right).
 *         - Function: fetchAndUpdateScores
 *         - Event source: Time-driven
 *         - Type: Minutes timer
 *         - Interval: Every 15 minutes
 *         - Save. Authorize.
 *
 * That's it. The script will run every 15 minutes, fetch finals from ESPN,
 * and update your Games tab automatically.
 */

// =============================================================================
// CONFIG
// =============================================================================
const ADMIN_KEY      = "CHANGE_ME_TO_A_LONG_RANDOM_STRING";   // <-- pick something only you know
const GAMES_TAB      = "Games";
const FIRST_GAME_ROW = 5;
const LAST_GAME_ROW  = 29;
const DATE_COL       = 2;   // B
const SPORT_COL      = 4;   // D
const FAV_COL        = 5;   // E
const DOG_COL        = 7;   // G
const FAV_SCORE_COL  = 8;   // H
const DOG_SCORE_COL  = 9;   // I

// ESPN's free scoreboard endpoints (used by espn.com itself).
// Path keys are the values that appear in your Games tab "Sport" column.
const ESPN_PATHS = {
  "NFL": "football/nfl",
  "CFB": "football/college-football",
  "NBA": "basketball/nba",
  "NHL": "hockey/nhl",
  "MLS": "soccer/usa.1",
};

// AHL — uses HockeyTech, the league's official stats backend (same one that
// powers the score widgets on theahl.com). Free, no auth, returns finals
// for the recent window.
const AHL_SCOREBAR_URL =
  "https://lscluster.hockeytech.com/feed/index.php" +
  "?feed=modulekit&view=scorebar&numberofdaysback=14&numberofdaysahead=0" +
  "&season_id=&league_code=&site_id=2&client_code=ahl" +
  "&key=41b145a848f4bd67&league_id=1&fmt=json";

// =============================================================================
// 1) ADMIN WRITE ENDPOINT (called by the website's Admin tab)
// =============================================================================
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

function doGet() {
  return jsonOut({ ok: true, msg: "Turkey Throwdown bridge is live." });
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// =============================================================================
// 2) AUTO-FETCH FROM ESPN
// =============================================================================

/**
 * Main auto-fetch function. Wire this to a 15-minute time trigger.
 * For each game that has empty score cells, try to find a final on ESPN
 * for that sport+date and write the scores back.
 */
function fetchAndUpdateScores() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(GAMES_TAB);
  if (!sheet) { Logger.log("Games tab not found"); return; }

  const range = sheet.getRange(FIRST_GAME_ROW, 1, LAST_GAME_ROW - FIRST_GAME_ROW + 1, FAV_SCORE_COL).getValues();
  // We only need columns 1..9; the read above pulls A..I.
  // range rows are 0-indexed; sheet row = FIRST_GAME_ROW + i

  // Cache scoreboards by "sport|date" so we hit each ESPN endpoint at most once
  const sbCache = {};
  let ahlGamesCache = null;   // lazy-fetched only if needed
  let updated = 0;
  let skippedFilled = 0;
  let noMatch = 0;
  let pending = 0;

  for (let i = 0; i < range.length; i++) {
    const row = range[i];
    const sheetRow = FIRST_GAME_ROW + i;
    const date  = row[DATE_COL - 1];
    const sport = String(row[SPORT_COL - 1] || "").trim();
    const fav   = String(row[FAV_COL   - 1] || "").trim();
    const dog   = String(row[DOG_COL   - 1] || "").trim();
    const favSc = row[FAV_SCORE_COL - 1];
    const dogSc = row[DOG_SCORE_COL - 1];

    if (favSc !== "" && dogSc !== "") { skippedFilled++; continue; }
    if (!(date instanceof Date)) { continue; }

    let matched = null;

    if (sport === "AHL") {
      if (ahlGamesCache === null) ahlGamesCache = fetchAHLScores_();
      matched = findMatchingAHLEvent(ahlGamesCache, fav, dog);
    } else if (ESPN_PATHS[sport]) {
      const events = getEventsForSportDate(sport, date, sbCache);
      if (events && events.length) matched = findMatchingEvent(events, fav, dog);
    } else {
      continue;   // unknown sport — skip
    }

    if (!matched) { noMatch++; continue; }
    if (!matched.final) { pending++; continue; }

    // matched.favScore corresponds to OUR fav (not the API's home/away)
    sheet.getRange(sheetRow, FAV_SCORE_COL).setValue(matched.favScore);
    sheet.getRange(sheetRow, DOG_SCORE_COL).setValue(matched.dogScore);
    updated++;
    Logger.log(`G${i+1} [${sport}] ${fav} vs ${dog} → ${matched.favScore}-${matched.dogScore}`);
  }

  Logger.log(`Done. updated=${updated} alreadyFilled=${skippedFilled} noMatch=${noMatch} pending=${pending}`);
}

/** Fetch the recent-finals scorebar from HockeyTech. */
function fetchAHLScores_() {
  try {
    const resp = UrlFetchApp.fetch(AHL_SCOREBAR_URL, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) {
      Logger.log(`AHL feed HTTP ${resp.getResponseCode()}`);
      return [];
    }
    const json = JSON.parse(resp.getContentText());
    const games = (json && json.SiteKit && json.SiteKit.Scorebar) || [];
    Logger.log(`AHL feed returned ${games.length} recent games`);
    return games;
  } catch (err) {
    Logger.log(`AHL fetch failed: ${err}`);
    return [];
  }
}

/** Match an AHL HockeyTech game to our (fav, dog). */
function findMatchingAHLEvent(games, favName, dogName) {
  const favTok = teamTokens(favName);
  const dogTok = teamTokens(dogName);
  if (!favTok.length || !dogTok.length) return null;

  for (const g of games) {
    // HockeyTech splits teams into separate fields (City, Nickname, Code, Abbreviation)
    const homeBlob = [g.HomeCity, g.HomeNickname, g.HomeAbbreviation, g.HomeCode].filter(Boolean).join(" ");
    const visBlob  = [g.VisitorCity, g.VisitorNickname, g.VisitorAbbreviation, g.VisitorCode].filter(Boolean).join(" ");
    const homeTok = teamTokens(homeBlob);
    const visTok  = teamTokens(visBlob);

    let favScore, dogScore;
    if (matches(favTok, homeTok) && matches(dogTok, visTok)) {
      favScore = g.HomeGoals;    dogScore = g.VisitorGoals;
    } else if (matches(favTok, visTok) && matches(dogTok, homeTok)) {
      favScore = g.VisitorGoals; dogScore = g.HomeGoals;
    } else {
      continue;
    }

    const status = String(g.GameStatus || "").toUpperCase();
    const final = status.indexOf("FINAL") !== -1;
    return {
      final,
      favScore: parseInt(favScore, 10),
      dogScore: parseInt(dogScore, 10),
    };
  }
  return null;
}

/** Pull (and cache) ESPN scoreboard events for a given sport+date.
 *  Tries the requested date first, then the day after (covers late games
 *  where ESPN's UTC date has rolled over). */
function getEventsForSportDate(sport, date, cache) {
  const path = ESPN_PATHS[sport];
  if (!path) return [];

  const ymd = formatYMD_(date);
  const key = `${sport}|${ymd}`;
  if (cache[key]) return cache[key];

  let events = espnFetch_(path, ymd);
  // Fallback: also check the next day (UTC roll-over for late games)
  const nextYmd = formatYMD_(new Date(date.getTime() + 24*3600*1000));
  const nextKey = `${sport}|${nextYmd}`;
  if (!cache[nextKey]) cache[nextKey] = espnFetch_(path, nextYmd);
  events = events.concat(cache[nextKey]);

  cache[key] = events;
  return events;
}

function espnFetch_(path, ymd) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${ymd}`;
  try {
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return [];
    const json = JSON.parse(resp.getContentText());
    return (json.events || []);
  } catch (err) {
    Logger.log(`ESPN fetch failed for ${url}: ${err}`);
    return [];
  }
}

/** Find an ESPN event whose two competitors match our fav and dog teams.
 *  Returns { final, favScore, dogScore } or null. */
function findMatchingEvent(events, favName, dogName) {
  const favTok = teamTokens(favName);
  const dogTok = teamTokens(dogName);
  if (!favTok.length || !dogTok.length) return null;

  for (const ev of events) {
    const comp = ev.competitions && ev.competitions[0];
    if (!comp) continue;
    const ctors = comp.competitors || [];
    if (ctors.length !== 2) continue;

    const c0Tok = competitorTokens(ctors[0]);
    const c1Tok = competitorTokens(ctors[1]);

    let favComp = null, dogComp = null;
    if (matches(favTok, c0Tok) && matches(dogTok, c1Tok)) { favComp = ctors[0]; dogComp = ctors[1]; }
    else if (matches(favTok, c1Tok) && matches(dogTok, c0Tok)) { favComp = ctors[1]; dogComp = ctors[0]; }
    else continue;

    const status = ev.status && ev.status.type && ev.status.type.completed;
    return {
      final: !!status,
      favScore: parseInt(favComp.score, 10),
      dogScore: parseInt(dogComp.score, 10),
    };
  }
  return null;
}

/** Strip a sheet team name down to alphabetic tokens for matching. */
function teamTokens(s) {
  return String(s)
    .toUpperCase()
    .replace(/[^A-Z ]/g, " ")
    .replace(/\bST\b/g, "STATE")            // "OHIO ST" → "OHIO STATE"
    .split(/\s+/)
    .filter(Boolean);
}

/** Build a token set from an ESPN competitor's various name fields. */
function competitorTokens(c) {
  const t = c.team || {};
  const blob = [t.displayName, t.shortDisplayName, t.name, t.location, t.abbreviation]
    .filter(Boolean).join(" ");
  return teamTokens(blob);
}

/** True if any token from a appears in b's token set. */
function matches(a, b) {
  const set = new Set(b);
  for (const t of a) if (set.has(t)) return true;
  return false;
}

function formatYMD_(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

// =============================================================================
// HANDY ONE-OFF FUNCTIONS YOU CAN RUN FROM THE APPS SCRIPT EDITOR
// =============================================================================

/** Run this once after install to make sure ESPN access works. Then check
 *  the execution log (View → Logs). */
function testFetchOneSport() {
  const today = new Date();
  const events = espnFetch_(ESPN_PATHS["NFL"], formatYMD_(today));
  Logger.log(`Fetched ${events.length} NFL events for today.`);
  events.slice(0, 3).forEach(ev => Logger.log(ev.shortName));
}

/** Run this to confirm the AHL feed is reachable from your Apps Script. */
function testFetchAHL() {
  const games = fetchAHLScores_();
  Logger.log(`AHL feed returned ${games.length} recent games.`);
  games.slice(0, 5).forEach(g =>
    Logger.log(`${g.VisitorCity} ${g.VisitorNickname} @ ${g.HomeCity} ${g.HomeNickname} — ${g.GameStatus} ${g.VisitorGoals}-${g.HomeGoals}`)
  );
}
