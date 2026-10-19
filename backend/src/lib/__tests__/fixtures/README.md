# Fixtures (lib tests)

## `tighten-episode-identity.json`

Tighten Episode's graph identity as P1 shipped it: for each row its inputs
(the raw settings, the recording's kind, the music, the probed length) and the
hash, `outputMap` and first-run subset P1 code built from them, plus one stored
snapshot. `use-case-p1-identity.test.ts` rebuilds every row and fails on any
difference, so a run P1 code started can still be continued and Render-finalled.
It was recorded once, on the unmodified P1 code, before the use-case registry
refactor (`WRITE_TIGHTEN_IDENTITY=1`). **Never re-record it after the
refactor**: a re-recording takes whatever the code then builds as the truth.

## `episode-trailer-identity.json`

Trailer's composed facts on the server before it became a node unit: its
request body (as JSON Schema), its `GET /v1/nodes` entry and charged
description, its use-case descriptor, the stored snapshot (graph, settings,
hash) of four built cases, the length it delivers for four intro-card cases,
its fee and the credit id a run reserves, the lists it belongs to, and its MCP
handle row. Only Trailer's own facts are kept, plus its predecessor in each
ordered list, so other nodes joining those lists never touch it. Each graph and
length row holds its own inputs, and `episode-trailer-identity.test.ts`
rebuilds every row from them. Its editor twin is
`frontend/src/__tests__/fixtures/episode-trailer-identity.json`.
Its `connectionsOut` froze the node-type-keyed validator's answers. One record
has since been corrected by hand, never re-recorded: `json → combine-videos.in`
is now false, because the validator reads the pip and a use-case node's plan
never feeds a media-only input (`usecaseDataPipRefused`). Any later validator
change is ruled on record by record — never re-record.

It was recorded once, on `feat/episode-trailer` before the units merge
(`UNITS_RECORD_TRAILER_IDENTITY=1`; the test refuses to overwrite an existing
fixture). **Never re-record it**: a re-recording takes whatever the code then
builds as the truth.

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
The `tracked: …` cases (Speaker View v3, P3.9) carry Speaker Frames' output
descriptor in `settings.tracks` and a `motion`: they pin the plugin's tracked
refusals (`invalid_tracks`, a motion it does not draw) and its no-coverage
rule, which the app's rule mirrors word for word.

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

## `clip-pack-identity.json`

Clip Pack's composed facts on the server before it became a node unit: its
request body (as JSON Schema), its `GET /v1/nodes` entry and charged
description, its use-case descriptor (`triesEvery` included), the stored
snapshot (graph, settings, hash) of 23 built cases (the defaults, every
framing shape including `null` "None" and the field-by-field fallbacks, the
caption variants, the count and length clamps, review on, an audio
recording), its length rule (none today: `videoOutputLength` answers
`no-rule`), its fee and the credit id a run reserves, the lists it belongs to,
and its MCP handle row. Only Clip Pack's own facts are kept, plus its
predecessor in each ordered list, so other nodes joining those lists never
touch it. Each graph and length row holds its own inputs, and
`clip-pack-identity.test.ts` rebuilds every row from them. Its editor twin is
`frontend/src/__tests__/fixtures/clip-pack-identity.json`, which also freezes
the audio lock (what an audio recording forces, what a video wired again gives
back, and the store's graph-wide lock over a drawn wire and a chain). Its
`connectionsOut` freezes today's node-type-keyed validator answers; if dev
changes the validator before the conversion, rule on it — never re-record.
json-pip wires into media-only inputs are deliberately not frozen (known
validator bug, fixed separately), and media-pip wires into JSON-only inputs
are deliberately not frozen either (same validator bug, reverse direction).
The request body (and the `/v1/nodes` input schema) freezes whole shared
vocabularies — caption styles, layouts, xfade switch ids; if dev grows one
before the merge, rule on it — never re-record. The editor twin also freezes the node
fields a run's shortfall lands on (`usecaseFailedDeliveriesField`).

It was recorded once, on `feat/clip-pack` before the units merge
(`UNITS_RECORD_CLIP_PACK_IDENTITY=1`; the test refuses to overwrite an existing
fixture). **Never re-record it**: a re-recording takes whatever the code then
builds as the truth.

## `use-case-single-recording-identity.json`

What a use-case node does with ONE recording, before the multicam work: the
facts the fixtures above leave open, so that work can prove it changes nothing
for one recording. Three sections, each row holding its own inputs:

- `graphs`: Chapters, Trailer and Clip Pack built from one recording (video,
  and audio where the type takes it; its probed length unknown or 3600 s; for
  Trailer, no intro card or one with an unknown or 6 s length) and the hash,
  `outputMap`, first-run subset and resolved settings built from it, plus one
  whole stored snapshot per type. Tighten Episode's graphs stay in
  `tighten-episode-identity.json`.
- `bodies`: what the engine sends each of the four types' routes
  (`freshRunInputs`, as a JSON string, key order included) for the defaults,
  tuned settings, empty and null settings, and two recordings with every
  optional input wired. Its editor twin,
  `frontend/src/__tests__/fixtures/use-case-single-recording-body.json`, keeps
  the body the canvas's own run sends for the same rows, by name; the editor
  test reads the inputs from here.
- `expansions`: what `expandUseCaseNodes` makes of each of the four types
  (nodes, edges, fees and members) unwired, wired to one recording (video, and
  audio where taken), to two, with every optional input and a consumer on each
  output, review on (first run and the whole chain) and in a Render final.
- `bodySchemas`: Tighten Episode's and Chapters' route bodies as JSON Schema
  (Trailer's and Clip Pack's are in their own fixtures).

`use-case-single-recording-identity.test.ts` and its editor twin rebuild every
row, and `use-case-single-recording-prepare.test.ts` holds the server's own
preparation to the graph rows (the body parsed by the route's schema, the
probes, `prepareUseCase`, and the route's keyless preflight graph), without
recording anything. The four types are named in the tests, never read from the
live type list, so a type added later records its own facts. Both fixtures
were recorded on dev before the multicam work
(`RECORD_SINGLE_RECORDING_IDENTITY=1`). This fixture is recorded section by
section: a write records only a section it does not hold yet and is refused
when it holds every one; the editor twin refuses to overwrite. **Never
re-record a section**: a re-recording takes whatever the code then builds as
the truth. A deliberate change to one record is ruled on and corrected by
hand, record by record.

Five records of the editor twin have since been corrected by hand, never
re-recorded: the canvas's run used to send a null on a setting whose body takes
no null (which the route refused), where the engine leaves it out. It now
follows the engine's rule (a null only where the body takes one,
`usecaseSettingTakesNull`), so these rows drop the refused nulls: "null
instructions and review" of each of the four types (`reviewBeforeRender`,
`instructions`) and Clip Pack's "framing None and captions null" (`captions`;
its `framing: null` is kept, the body takes it).

Thirteen more were corrected by hand the same way when the canvas's run came
to send an empty free-text setting (`instructions: ""`, `styleGuide: ""`), as
the engine always has (both engines now share `usecaseSentSettings`, which
sends an empty string only where the body takes one — free text — and leaves
any other empty value out; no engine row changed, since every empty value in
these rows is free text): the
"defaults" and "an empty instruction and style guide" rows of each of the
four types, Tighten Episode's "a music bed" and "framing None", Trailer's "an
intro card", and Clip Pack's "framing None" and "framing None and captions
null". Every editor row now equals its engine row plus the caller's `userId`.

One record was corrected by hand, never re-recorded, when Tighten Episode
came to take up to six recordings (ruled 2026-10-19), recomputed with the
test's own function: `bodySchemas["tighten-episode"]` — the route's body takes
one to six recordings, a Master audio (`masterAudioUrl`) and the Cameras
settings (`cameras`, read only by a run on several recordings or a Master
audio). Several recordings are read only for a viewer who may use Speaker Map;
every engine and estimate call these fixtures make is a viewer who may not, so
every body and expansion row — the two-recording rows included — is the run
exactly as before, unchanged.
