# 2v2 Lineup

An installable web app (PWA) that picks fair, random lineups for 2v2 racquetball. It records results and keeps daily, monthly and yearly stats in a Google Sheet.

**App:** https://vtlinh.github.io/racquetball-tracker/
**Sheet:** [2v2 Lineup Stats](https://docs.google.com/spreadsheets/d/109RhqZoesws9rdQiX4wP1U4RWSdd_4pGlFx_hef0e7s/edit)

## How lineups are picked

- Tap players to check in or out (default roster: Rick, Leo, Linh, Nate, Doug). Anyone can join or leave mid-day, and the teams are reshuffled when they do.
- **5 players:** 2v2 with one sitting out. At the start the sitter is random. After a result, the sitter comes from the losing team: whoever has played the most today (ties are broken randomly). The previous sitter always comes back in.
- **4 players:** 2v2, nobody sits out.
- **3 players:** cut-throat (one winner). **2 players:** 1v1.
- **The winning pair is never teamed together in the next match.** Among the remaining options, the split with the fewest repeat teammates today is picked, so pairings spread out.
- **Manual overrides:** tap a player, then tap another player to swap them (works between teams and the bench). Tap the bench to sit a player out, for example to sit one of 4 players out for a cut-throat game. Use "to court" to bring someone back. An override applies to that match only.
- The shuffle button re-splits the current players into a different legal pairing.

## Buttons

| Icon | Action |
| --- | --- |
| Trophy (on each team) | That team or player won. The next lineup is picked automatically. |
| Undo | Reverts the last action, whether a result, a check-in, an edit, Reset or Done. You can undo all the way back to an empty session. |
| Shuffle | Re-split the teams. |
| Check | **Done**: stamps today's per-player stats into the sheet (`Days` and `Matches` tabs). |
| Reset | Start over with the same players checked in. |
| Chart | Stats: Today (live), Month, Year. |
| Sliders | Settings: roster and the Google Sheet connection. |

## Google Sheet storage

The sheet has these tabs (set up already):

- `Days`: one row per player per concluded day (played, wins, losses, sat out).
- `Matches`: every match of every concluded day.
- `Monthly` and `Yearly`: per-player summaries built with `QUERY` formulas over `Days`.
- `Players`: the roster.
- `State`: the live session and undo history (managed by the app). This is how several phones share the same session.

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
```

Pushing to `main` runs the tests and publishes the site to the `gh-pages` branch (GitHub Pages).
