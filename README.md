# Turkey Throwdown 2026

A static website (GitHub Pages) for the Thanksgiving 2026 pick'em pool. Reads everything live from the Google Sheet — the Sheet remains the source of truth.

**Live URL:** `https://nickssportspools-afk.github.io/TURKEY-THROWDOWN/` (will work after step 4 below)

## What's in here

| File | Purpose |
| --- | --- |
| `index.html` | The whole website. Single file with embedded CSS + JS. |
| `apps-script.gs` | Google Apps Script that lives inside your Sheet. Lets the Admin tab on the site write final scores back to the Sheet. |
| `.nojekyll` | Tells GitHub Pages to serve files exactly as-is (skip Jekyll). |
| `README.md` | This file. |

## Setup (do this once, in order)

### 1. Make sure the Google Sheet is shared

Open your Sheet → click **Share** (top right) → set **General access** to **"Anyone with the link"**, role **Viewer**. Without this, the site can't read it.

The site's `SHEET_ID` constant is already set to your sheet (`15P_r3oaAu0Q1izY5B3cEDI98bPoX63V4DWlrC-uOu6s`). If you ever switch sheets, update that line in `index.html`.

### 2. Push these files to GitHub

```bash
cd ~/Downloads/turkey-throwdown
git init
git add .
git commit -m "Initial Turkey Throwdown site"
git branch -M main
git remote add origin https://github.com/nickssportspools-afk/TURKEY-THROWDOWN.git
git push -u origin main
```

(Create the empty `TURKEY-THROWDOWN` repo on github.com first if it doesn't exist.)

### 3. Enable GitHub Pages

In your repo on GitHub:

1. **Settings** → **Pages** (left sidebar)
2. **Source:** Deploy from a branch
3. **Branch:** `main` / `(root)`
4. Click **Save**

Wait ~30 seconds. Your site will be live at `https://nickssportspools-afk.github.io/TURKEY-THROWDOWN/`.

### 4. Install the Apps Script bridge (Admin tab + auto-score-fetch)

The same script does two things: lets the website's Admin tab write scores to the Sheet, AND auto-fetches finals from ESPN every 15 minutes so most scores update without you doing anything.

1. Open your Google Sheet → **Extensions** → **Apps Script**.
2. Delete whatever's in `Code.gs` and paste the entire contents of `apps-script.gs`.
3. **Edit the line near the top** that says `const ADMIN_KEY = "CHANGE_ME_TO_A_LONG_RANDOM_STRING";` and replace the value with a long random string only you know. (Generate one with `openssl rand -hex 24` or just mash some keys.)
4. Click the **Save** icon (or Ctrl/Cmd-S).
5. Click **Deploy** (top right) → **New deployment**.
   - Click the gear icon → choose **Web app**.
   - **Description:** "Turkey Throwdown bridge"
   - **Execute as:** Me
   - **Who has access:** Anyone
   - Click **Deploy**. Authorize the prompt.
6. **Copy the Web app URL** that appears (it ends in `/exec`).
7. Open `index.html`, find the line `const SCRIPT_URL = "";` near the top of the `<script>` block, paste the URL between the quotes. Save and re-push.
8. On the live site, go to the **Admin** tab and paste your `ADMIN_KEY` into the "Admin key" field. The browser remembers it locally.

### 5. Set up the auto-fetch schedule

This is what makes scores appear on the Sheet automatically as games end.

1. Still in the Apps Script editor, click the **alarm-clock icon** (Triggers) in the left sidebar.
2. Click **+ Add Trigger** at the bottom right.
3. Configure the trigger:
   - **Choose which function to run:** `fetchAndUpdateScores`
   - **Choose deployment:** Head
   - **Select event source:** Time-driven
   - **Select type of time-based trigger:** Minutes timer
   - **Select minute interval:** Every 15 minutes
4. Click **Save**. Authorize when prompted (Google may flag it as "unverified" — click "Advanced → Go to (project name)" to proceed).

The script now runs every 15 minutes. For each game on your Games tab where score columns are still empty, it'll pull the final from ESPN if available and write it in.

**Coverage:**
- **NFL, College Football, NBA, NHL, MLS** — fetched from ESPN's free scoreboard API.
- **AHL** — fetched from HockeyTech (the AHL's own stats backend, same data that powers theahl.com's score widgets).
- If either source goes down or the team-name match fails, that game just stays empty until the next 15-minute run, OR until you enter it manually via the Admin tab.

**Manual entries always win.** If you've already typed a score, the auto-fetcher won't touch that row.

**Watching it work:** in the Apps Script editor, click the bug icon ("Executions") in the left sidebar to see the log of each run. Each one logs how many games it updated.

## Day-to-day use

- **Players** open the site URL on their phones to see games, standings, and (after you reveal them) everyone's picks.
- **You** keep the Google Sheet open. As games end, type the final scores into columns H and I of the Games tab (or use the Admin tab on the site, which does the same thing).
- The site auto-refreshes every minute. You shouldn't have to do anything else.

## Customizing

- **Sheet ID changes:** edit `SHEET_ID` in `index.html`.
- **Apps Script URL changes:** edit `SCRIPT_URL` in `index.html`.
- **Admin key changes:** edit `ADMIN_KEY` in the Apps Script (then redeploy: Deploy → Manage deployments → pencil icon → New version → Deploy).
- **Auto-refresh interval:** change `REFRESH_MS` (in milliseconds) in `index.html`.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| "Failed to load" on every tab | Sheet isn't shared as "Anyone with the link" |
| Picks tab says "No entrants yet" | Players haven't typed names into the NAME header cells (row 6 of Picks tab) |
| Standings shows zeros | Scores haven't been entered on the Games tab yet |
| Admin "Save" returns "Bad admin key" | Mismatch between key on website and `ADMIN_KEY` in Apps Script |
| Admin "Save" returns "HTTP 0" / network error | Apps Script not deployed as "Anyone access" |
| Tabs in Sheet renamed | Site looks for tabs named exactly `Games`, `Picks`, `Standings`. Rename them back or update `fetchSheet(...)` calls. |
