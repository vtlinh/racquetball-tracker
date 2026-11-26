# 2v2 Lineup

An installable web app (PWA) that picks fair, random lineups for 2v2 racquetball. It records results and keeps daily, monthly and yearly stats in a Google Sheet.

**App:** https://vtlinh.github.io/racquetball-tracker/
**Sheet:** [2v2 Lineup Stats](https://docs.google.com/spreadsheets/d/109RhqZoesws9rdQiX4wP1U4RWSdd_4pGlFx_hef0e7s/edit)

## How lineups are picked

- Tap a player's name to include them in the lineup or leave them out (default roster: Rick, Leo, Linh, Nate, Doug). Anyone can join or leave mid-day, and the teams are reshuffled when they do.
- When the Eastern Time date changes, the players who are still here are dealt a new lineup. Yesterday's teams do not carry over.
- **5 players:** 2v2 with one sitting out. At the start the sitter is random. After a result, the sitter comes from the losing team: whoever has played the most today (ties are broken randomly). The previous sitter always comes back in.
- **4 players:** 2v2, nobody sits out.
- **3 players:** cut-throat (one winner). **2 players:** 1v1.
- **The winning pair is never teamed together in the next match.** Among the remaining options, the split with the fewest repeat teammates today is picked, so pairings spread out.
- **Manual overrides:** tap a name on the court, then tap another name to swap them (works between teams and the "Out" players). The coffee cup beside a name sits that player out, and more than one player can sit. Tap the cup again to bring them back while the court has room for them. An override applies to that match only.
- **Changing who sits out always reshuffles the teams**, so the player coming in doesn't just take the old spot. A swap that would put the last winning pair on the same team is refused, so that rule holds for manual changes too.
- The shuffle button re-splits the current players into a different legal pairing. On a two-team court a ball travels between the teams. Its color holds on green, blue, violet, pink, red, and black for 2 seconds each, then eases into the next over 1 second. It stops on the inner edge of each side's names and rebounds off the top and bottom walls. On a triple the court lines match a two-team court. The three names stack A–Z in the center of the left section, with the trophy to the left of each name, and the ball bounces from the right edge of the names to the right wall. On a doubles side the two names are A–Z as well.

## Results by day

- Every result is saved under its date as soon as you tap the trophy beside a team. There's no end-of-day step: each day's rows in the sheet are rewritten automatically whenever that day changes.
- The day picker at the top (‹ Today ›) chooses which day new results go to. Today is the Eastern Time date, so an evening game stays on that day. The arrows move between days that already have results, skipping empty ones, and the forward arrow can always come back to today even when today has no games yet. Tap the date to jump to any day, including one with no games yet. A past day is shown in gold.
- Below the All/Year/Month stats, results are grouped by day, newest day first and newest result first. Only today starts expanded. Opening a day collapses the others, so one day is open at a time. Each result shows the time it was recorded, in Eastern Time, as `HH:MM`, and the score change beside each name, green for a gain (`+4` in singles, `+3` in doubles, `+6` in a triple) and orange for a loss (`-4` in singles, `-3` in doubles or a triple). The winning side of a doubles result is the first line, and `beat` with the other side is the second line. A triple stays on one line. Each day shows every player's score, colored from orange at the lowest to green at the highest. Use ⇄ to change a result's winner and × to delete it.
- Singles score +4 for the winner and −4 for the loser. Doubles score +3 for each winner and −3 for each loser. A triple scores +6 for the winner and −3 for each of the other two. Sitting out does not change the score.
- 👑 goes to the day's highest score and 💩 to the lowest. A tie for either gets nobody. On the player row the mark sits above that player's name. In a day's history it sits beside the name. Only a player who played at least one game can receive one.

## Buttons

| Icon                       | Action                                                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trophy (beside the names)  | That team or player won, recorded on the day shown at the top, with the real time of the tap (`HH:MM` Eastern Time). The next lineup is picked automatically.  |
| Undo                       | Reverts the last change to results: a win, a changed winner or a deleted result. Check-ins, sit-outs, swaps and shuffles aren't undone.                        |
| Redo                       | Puts back the last undone result change. It appears only after an undo, and a new result clears it.                                                            |
| Shuffle                    | Re-split the teams.                                                                                                                                            |
| ‹ date ›                   | Move between days that have results. Tap the date to jump to any day.                                                                                          |
| Player name                | Include that player in the lineup, or leave them out.                                                                                                          |
| Coffee cup (beside a name) | Sit that player out, or bring them back. Several players can sit at once.                                                                                      |
| All / Year / Month, arrows | Stats for all time, a year, or a month, with that period's results by day. Opens on All, and remembers the last choice on this device. All time has no arrows. |
| Utensils                   | Edit the restaurant list. Each place has a list weight from 1 to 5, and 5 is picked most often. The list is ordered by that weight, highest first, then by name. Claim your name on this browser; that name stays yours until you remove the claim or the claim is cleared in the sheet. Your weights show under your name. A name with no weight counts as the average of the names that set one. The first game day seeds the sequence, and each later game day takes the next place. The next game day picks a different place unless the list has only one. |
| Read only                  | Hides the edit buttons and ignores writes: wins, swaps, sit-outs, check-ins, shuffles, undo, redo, result edits, and the restaurant list. Tap it again and confirm to edit. The choice is remembered on this device. |

Each day in the results shows the score. Played and won are in the stats table. Names are A–Z until you tap a column. Tapping Player lists Z–A, and tapping it again returns to A–Z. On Played, Won, Win %, and Score, the first tap puts the higher value on top, the next tap reverses it, and a third tap returns to A–Z. A down arrow marks higher-first, and an up arrow marks the reverse on those columns.

## Google Sheet storage

The sheet has these tabs (set up already):

- `Days`: one row per player per day (played, wins, losses, sat out), keyed by date.
- `Matches`: every match, keyed by date. The Time column is Eastern Time (24-hour).
- `Monthly` and `Yearly`: per-player summaries built with `QUERY` formulas over `Days`.
- `Players`: the roster.
- `State`: all results by day, the live lineup, and the undo and redo history (managed by the app). This is how several phones share the same session.

Google doesn't allow anonymous writes to a sheet through its API, even when the sheet is world-editable. The app talks to an Apps Script web app bound to the sheet ([`apps-script/Code.gs`](apps-script/Code.gs)). Its URL is fixed in [`js/config.js`](js/config.js).

The device caches the last state, so the app works offline. Changes made offline are sent to the sheet when the connection returns.

## Development

No build step: static HTML, CSS and ES modules.

```bash
npm test         # lineup rules + sheet sync (runs apps-script/Code.gs against an in-memory sheet)
npm run serve    # http://localhost:8080
npm run icons    # regenerate PNG icons
node tests/mock-api-server.mjs   # local stand-in for the Apps Script API on :8081
```

Pushing to `main` runs the tests and publishes the site to the `gh-pages` branch (GitHub Pages). Merge a finished pull request into `main` once its tests pass. That merge is what publishes the site. A newer request steers the work and does not drop one already made. Finish each request and merge it.

GitHub Pages has to be switched on once by a repo admin: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, then pick **`gh-pages`** and **`/ (root)`** and save. The app is then live at https://vtlinh.github.io/racquetball-tracker/ and updates on every push to `main`.
