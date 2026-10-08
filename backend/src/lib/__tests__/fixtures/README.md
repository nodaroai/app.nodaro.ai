# Fixtures (lib tests)

## `speaker-view-parity.json`

The cloud plugin's own answers to a set of Speaker View requests: the drift
check for the app's rule in `@nodaro/render-rules` (`speaker-view-*.ts`). The
rule MIRRORS what the plugin's route refuses and how it lays a segment out
(SV24 relaxed, the late-camera snap), so the editor's badge and the backend's
ingress say "refused" for exactly the edits the plugin refuses.
`speaker-view-parity.test.ts` runs every case through the app's rule and fails
when the two disagree.

Each case holds the request as given (`edl`, `transcript`, `transcriptAsString`,
`settings` in the route's wire shape) and `expected`: the plugin's refusal code
(`null` when it renders), its message, and — for `scope: "full"` cases only —
the layout and cameras it draws on each segment and its late-camera notes.
`scope: "verdict"` cases compare only refused-or-not and the refusal code,
because the plugin splits an UNNAMED segment at transcript turns before it lays
it out, and that split is the plugin's own taste and is deliberately not copied
into the public app (the app counts segments, the plugin counts the pieces).
Named edits (a Camera Switch output) are never split, so those compare in full.

Regenerate it whenever the plugin's input checks or layout stage change:

1. In the plugins repo, open a worktree of `origin/main` (never the shared
   checkout) and `npm ci` in it, so `@nodaro/shared` resolves to the pinned
   version the plugin really runs.
2. Save the script below as a scratch test beside the plugin's tests, so
   `../input.js` resolves (do not commit it).
3. Run it, with `FIXTURE` the current fixture, `OUT` the new one and `SOURCE`
   naming the plugin commit, and copy `OUT` over this file.

```sh
FIXTURE=<app>/backend/src/lib/__tests__/fixtures/speaker-view-parity.json \
OUT=/tmp/speaker-view-parity.json SOURCE="nodaro-cloud-plugins origin/main <sha> (<why>)" \
npx vitest run <the scratch test file>
```

The script keeps every case's inputs and recomputes `expected` only, so a rule
change shows up as a diff of the expectations. To add a case, append
`{ name, scope, edl, transcript?, transcriptAsString?, settings? }` to `cases`
first (leave `expected` out); the script fills it in.

```ts
import { readFileSync, writeFileSync } from "node:fs"
import { it } from "vitest"
import { resolveEdlSegmentSlots } from "@nodaro/shared"
import { resolveTargetAspect } from "../canvas.js"
import { SpeakerViewInputError, coerceSpeakerViewEdl, prepareSpeakerViewRender } from "../input.js"
import { layOutSpeakerView, speakerViewSlotSet } from "../layout-assign.js"
import { splitSpeakerTurns } from "../turns.js"

it("regenerate", () => {
  const fx = JSON.parse(readFileSync(process.env.FIXTURE!, "utf8"))
  for (const c of fx.cases) {
    const transcript = c.transcript === undefined ? undefined : c.transcriptAsString ? JSON.stringify(c.transcript) : c.transcript
    const settings = { ...(c.settings ?? {}), ...(transcript !== undefined ? { transcript } : {}) }
    const expected: Record<string, unknown> = { refusal: null }
    try {
      prepareSpeakerViewRender(c.edl, settings)
    } catch (err) {
      if (!(err instanceof SpeakerViewInputError)) throw err
      expected.refusal = err.code
      expected.message = err.message
    }
    if (c.scope === "full" && expected.refusal === null) {
      const edl = coerceSpeakerViewEdl(c.edl)
      const split = splitSpeakerTurns(edl, transcript)
      const aspect = resolveTargetAspect(settings.targetAspect, edl)
      const laid = layOutSpeakerView(split, { aspect, ...(settings.layout !== undefined ? { layout: settings.layout } : {}), transcript, speakers: speakerViewSlotSet(edl, transcript) })
      const before = new Set(edl.meta?.notes ? String(edl.meta.notes).split("\n") : [])
      expected.segments = laid.segments.map((s) => ({ id: s.id, mode: s.layout?.mode ?? "single", slots: resolveEdlSegmentSlots(laid, s).map((r) => r.source) }))
      expected.notes = String(laid.meta?.notes ?? "").split("\n").filter((l) => l && !before.has(l))
    }
    c.expected = expected
  }
  writeFileSync(process.env.OUT!, JSON.stringify({ ...fx, source: process.env.SOURCE ?? "", cases: fx.cases }) + "\n")
})
```
