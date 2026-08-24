# Crostics

A playable acrostic word game in a single self-contained HTML file.

## Play the prototype

Anyone can open this in a browser (phone or desktop). No install.

**Play here:** https://praneethgadipudi.github.io/crostics/

That URL is the shareable link. Progress is saved only in the player's own
browser, so testers do not overwrite each other. Ads are placeholders. Hints are
unlimited for this test build. Food Origins is the playable pack of ten puzzles;
the other theme tabs are coming soon.

## Running it locally

Double click `index.html`, or open it in any browser. There is no build step, no
server and no network dependency at runtime, which is deliberate: the same file
is meant to drop straight into a WebView for the Android build later.

Add `#3` to the URL to jump directly to puzzle 3. Handy while testing.

## How the puzzle works

A hidden quotation is laid out as a grid of numbered cells. Below it sits a list
of clues. Every letter of every answer is wired to one specific cell of the
quote, so solving a clue reveals scattered letters of the quotation, and letters
you work out in the quotation fill themselves into the clue answers. You can
work from either side.

Two deliberate departures from a classic double-crostic:

- **Unindexed quote cells.** Two to four cells in each quote are fed by no clue
  at all. Solving every clue is not quite enough; those letters have to be
  reasoned out from context.
- **Unindexed answer letters.** Two to four letters across the answers never
  appear in the quotation, so a solved clue does not always hand over its full
  length.

Both counts scale with difficulty, and both are also what gives the content
generator enough slack to find a valid puzzle at all.

### Rules as implemented

- The cursor starts on the first letter of clue A.
- A wrong letter costs one strike and stays on the board in red, so you can
  delete or overwrite it. Three strikes ends the run.
- A fully correct answer turns green and locks. Anything incomplete or wrong
  stays editable.
- Selecting any cell softly highlights every other cell that belongs to the same
  answer, in both the quote and the clue list, and the exact counterpart cell is
  highlighted more strongly.
- A hint reveals the selected cell and costs one hint.
- Backing out mid-solve saves your letters, locked words and remaining strikes.

### Streaks

The streak goes up on any completed puzzle, including one you finished after a
Revive or a Retry, since both keep the attempt alive. Closing the fail popup and
walking away is the only thing that resets it. Every fifth consecutive win grants
one hint.

## Ads and currency

Ads are not integrated. Watch-to-earn and interstitial slots show a full screen
placeholder for two seconds and then continue, and every screen reserves the
bottom strip for a banner. Retry displays a cost of 20 coins but does not deduct
anything, because coins do not exist yet.

## Content pipeline

The letters of all the answers have to add up to the letters of the quotation,
within the small slack described above. That is not something to work out by
hand ten times, so it is generated and verified:

```
cscript //nologo tools\build-puzzles.js
```

The builder is plain ES3 JScript and runs on Windows Script Host, so it needs no
toolchain installed. It:

1. reads `tools/puzzle-source.json` (the quotes and fun facts) and
   `tools/word-clue-bank.json` (the answer bank),
2. searches the bank for a set of answers that covers each quote,
3. assigns every answer letter to a specific quote cell and picks which cells
   stay unindexed, keeping at most one hole per word of the quote,
4. verifies the mapping cell by cell and refuses to emit a broken puzzle,
5. scores difficulty and fails if the ten puzzles do not strictly increase,
6. writes `tools/puzzles.generated.json`, a readable `tools/puzzles-report.txt`,
   and injects the data into `index.html` between the `PUZZLE_DATA` markers.

It is deterministic. The same inputs always rebuild the same pack.

### Adding puzzles

Add answers and clues to `tools/word-clue-bank.json`, add an entry to
`tools/puzzle-source.json`, and rerun the builder. The quote must appear
verbatim inside one of the fun fact paragraphs so the review screen can
highlight it. Each puzzle entry controls its own levers:

- `clues` - the allowed answer counts
- `quoteFree` / `answerFree` - the unindexed ranges on each side
- `maxLen` - longest answer allowed
- `latePull` - how strongly unindexed cells are pushed towards the end of the
  quote, where surrounding context helps least
- `foodWords` - minimum number of answers drawn from the food-tagged list

If the search fails, the builder prints the quote's letter histogram so you can
see which letters the bank cannot cover.

### Difficulty

Score combines answer count, quote length, unindexed counts, letter entropy,
vowel ratio and average answer length. Entropy is used rather than a
distinct-over-total ratio because that ratio falls automatically as a quote gets
longer, which would fight the length lever instead of complementing it. Current
ladder, puzzles 1 to 10: 88.8, 95.8, 100.9, 113.9, 118.4, 127.4, 136.7, 144.1,
150.7, 159.6.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The entire game. Ships on its own. |
| `tools/build-puzzles.js` | Content generator and validator. Dev only. |
| `tools/puzzle-source.json` | Quotes, fun facts and per-puzzle levers. |
| `tools/word-clue-bank.json` | Answer and clue bank the generator draws from. |
| `tools/puzzles.generated.json` | Build output, also injected into the game. |
| `tools/puzzles-report.txt` | Readable dump for eyeballing each puzzle. |

## Notes for the next step

- `SEQUENTIAL_UNLOCK` near the top of the script gates puzzle N behind puzzle
  N-1. It is off so any puzzle can be opened for testing.
- Fun fact art is inline SVG so the file stays self-contained. Each puzzle has an
  `art` key, so swapping in real images later does not touch the engine.
- Progress lives in one `localStorage` key, `crostics.foodOrigins.v1`.
- State is held in a flat slot store with no framework, which keeps the file
  dependency free and makes a later port to React mechanical rather than a
  rewrite.
