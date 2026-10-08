# Fixtures

## `speaker-view-turn-split.json`

The plugin's own turn splits, the drift check for `speaker-view-budget.ts`. The
budget bounds the split from above and never copies the plugin's rule, so this
file is the only place the two meet. Each case holds the edit and the turns as
given, plus `split`: what the plugin's `splitSpeakerTurns` made of them (or
`"unchanged"`). `minShotMs` is the plugin's `SPEAKER_VIEW_MIN_SHOT_MS`,
written by the generator and never typed by hand.

Regenerate it when the plugin's turn rules change:

1. In the plugin checkout, switch to the branch that holds the turn rules
   (the open Speaker View change while it is open, then the release that has it).
2. Save the script below as a scratch test file beside the plugin's turn-split
   tests, so `../turns.js` resolves (do not commit it).
3. Run it, with `FIXTURE` the current fixture and `OUT` the new one, and copy
   `OUT` over this file. Edit `source` to name the new plugin commit.

```sh
FIXTURE=<app>/backend/src/providers/video/__tests__/fixtures/speaker-view-turn-split.json \
OUT=/tmp/speaker-view-turn-split.json \
npx vitest run <the scratch test file>
```

The script keeps every case's `edl`, `turns` and `transcriptAsString` and
recomputes `split` and `minShotMs` only, so a rule change shows up as a diff of
the splits. With no rule change the output is byte-identical to this file. To
add a case, append `{ name, edl, turns, transcriptAsString }` to `cases` in the
fixture first (leave `split` out); the script fills it in.

```ts
import { readFileSync, writeFileSync } from "node:fs"
import { it } from "vitest"
import { SPEAKER_VIEW_MIN_SHOT_MS, splitSpeakerTurns } from "../turns.js"

type Turn = [string | null, number, number]
// A word every 500 ms from each turn's start, 450 ms long, the last clipped to
// the turn's end; a null speaker is an unlabelled word.
const talk = (turns: Turn[]) => {
  const words: unknown[] = []
  for (const [speaker, a, b] of turns) {
    for (let t = a; t < b; t += 500) words.push({ text: "w", startMs: t, endMs: Math.min(t + 450, b), ...(speaker ? { speaker } : {}) })
  }
  return { version: 1, words }
}

it("regenerate", () => {
  const fx = JSON.parse(readFileSync(process.env.FIXTURE!, "utf8"))
  for (const c of fx.cases) {
    const transcript = c.turns === null ? undefined : c.transcriptAsString ? JSON.stringify(talk(c.turns)) : talk(c.turns)
    const out = splitSpeakerTurns(c.edl, transcript)
    c.split = out === c.edl ? "unchanged" : out
  }
  const { cases, ...head } = fx
  writeFileSync(process.env.OUT!, JSON.stringify({ ...head, minShotMs: SPEAKER_VIEW_MIN_SHOT_MS, cases }) + "\n")
})
```
