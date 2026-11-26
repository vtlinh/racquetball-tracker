# 2v2 Lineup

An installable web app (PWA) that picks fair, random lineups for 2v2 racquetball. It records results and keeps daily, monthly and yearly stats in a Google Sheet.

**App:** https://vtlinh.github.io/racquetball-tracker/
**Sheet:** [2v2 Lineup Stats](https://docs.google.com/spreadsheets/d/109RhqZoesws9rdQiX4wP1U4RWSdd_4pGlFx_hef0e7s/edit)

## How lineups are picked

- Tap a player's name to include them in the lineup or leave them out (default roster: Rick, Leo, Linh, Nate, Doug). Anyone can join or leave mid-day, and the teams are reshuffled when they do.
- **5 players:** 2v2 with one sitting out. At the start the sitter is random. After a result, the sitter comes from the losing team: whoever has played the most today (ties are broken randomly). The previous sitter always comes back in.
- **4 players:** 2v2, nobody sits out.
- **3 players:** cut-throat (one winner). **2 players:** 1v1.
- **The winning pair is never teamed together in the next match.** Among the remaining options, the split with the fewest repeat teammates today is picked, so pairings spread out.
- **Manual overrides:** tap a name on the court, then tap another name to swap them (works between teams and the "Out" players). The coffee cup under a name sits that player out, and more than one player can sit. Tap the cup again to bring them back while the court has room for them. An override applies to that match only.
- **Changing who sits out always reshuffles the teams**, so the player coming in doesn't just take the old spot. A swap that would put the last winning pair on the same team is refused, so that rule holds for manual changes too.
- The shuffle button re-splits the current players into a different legal pairing.

## Results by day

- Every result is saved under its date as soon as you tap **Win**. There's no end-of-day step: each day's rows in the sheet are rewritten automatically whenever that day changes.
- The day picker at the top (‹ Today ›) chooses which day new results go to. Today is the Eastern Time date, so an evening game stays on that day. Tap the date to jump to any past day, or use the pencil on a day in the results list. A past day is shown in gold.
- Below the Month/Year stats, results are grouped by day, newest day first and newest result first. Each result shows the time it was recorded, in Eastern Time, as `HH:MM`. Each day shows every player's wins-losses. Use ⇄ to change a result's winner and × to delete it.
- 👑 goes to the day's most wins (a tie goes to whoever lost fewer); 💩 goes to the most losses (a tie goes to whoever won fewer). If it's still tied, nobody gets it.

## Buttons

| Icon | Action |
| --- | --- |
| Win (on each team) | That team or player won, recorded on the day shown at the top, with the real time of the tap (`HH:MM` Eastern Time). The next lineup is picked automatically. |
| Undo | Reverts the last change to results: a win, a changed winner or a deleted result. Check-ins, sit-outs, swaps and shuffles aren't undone. |
| Redo | Puts back the last undone result change. It appears only after an undo, and a new result clears it. |
| Shuffle | Re-split the teams. |
| ‹ date › | Pick the day results are recorded on. |
| Player name | Include that player in the lineup, or leave them out. |
| Coffee cup (under a name) | Sit that player out, or bring them back. Several players can sit at once. |
| Month / Year, arrows | Stats for a month or year, with that period's results by day. |
| "Saved in this browser." | Tap it for settings: roster and the Google Sheet connection. |

Played and won for the day are in the results at the bottom.

## Google Sheet storage

The sheet has these tabs (set up already):

- `Days`: one row per player per day (played, wins, losses, sat out), keyed by date.
- `Matches`: every match, keyed by date. The Time column is Eastern Time (24-hour).
- `Monthly` and `Yearly`: per-player summaries built with `QUERY` formulas over `Days`.
- `Players`: the roster.
- `State`: all results by day, the live lineup, and the undo and redo history (managed by the app). This is how several phones share the same session.

Google doesn't allow anonymous writes to a sheet through its API, even when the sheet is world-editable. So the app talks to a small Apps Script web app bound to the sheet ([`apps-script/Code.gs`](apps-script/Code.gs)). It's a one-time setup:

1. Open the sheet and go to **Extensions → Apps Script**.
2. Replace `Code.gs` with [`apps-script/Code.gs`](apps-script/Code.gs) (the app's settings have a copy button), then save.
3. Go to **Deploy → New deployment → Web app**. Set *Execute as* to **Me** and *Who has access* to **Anyone**, then deploy and authorize.
4. Copy the `/exec` URL into the app's settings. To configure another phone, open `https://vtlinh.github.io/racquetball-tracker/?api=<exec-url>` once. You can also put the URL in `DEFAULT_API_URL` in [`js/config.js`](js/config.js) so every device picks it up.

Until the sheet is connected, everything is kept on the device. The device also caches the last state, so the app works offline. Changes made offline are sent to the sheet when the connection returns.

## Development

No build step: static HTML, CSS and ES modules.

```bash
npm test         # lineup rules + sheet sync (runs apps-script/Code.gs against an in-memory sheet)
npm run serve    # http://localhost:8080
npm run icons    # regenerate PNG icons
node tests/mock-api-server.mjs   # local stand-in for the Apps Script API on :8081
                                 # then open http://localhost:8080/?api=http://localhost:8081/exec
```

Pushing to `main` runs the tests and publishes the site to the `gh-pages` branch (GitHub Pages).

GitHub Pages has to be switched on once by a repo admin: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, then pick **`gh-pages`** and **`/ (root)`** and save. The app is then live at https://vtlinh.github.io/racquetball-tracker/ and updates on every push to `main`.
