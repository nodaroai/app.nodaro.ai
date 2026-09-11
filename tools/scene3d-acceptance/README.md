# Scene3D / 3D Render Pro acceptance harness

Six probes against a **live deployment**, each answering one acceptance
question and each leaving a JSON receipt of what it did, what it measured and
what it concluded. Everything here spends **real credits**. There is no mock
and no test mode: what is being accepted is the deployed system, and a harness
that could pass against a fake would be worth nothing.

What it does instead of a mock:

- it **refuses to spend** when the answer would be meaningless — an
  unavailable capability exits `3` with a receipt and no job;
- it **never resubmits a paid request** whose outcome is unknown. A submit that
  throws is reported with its `Idempotency-Key`, and the way to find out what
  happened is `lifecycle --observe <jobId>`, never a second send;
- it **writes the receipt as it goes**, not at the end. A run that dies during
  a thirty-minute render still leaves behind everything it knew, because the
  credits are spent either way.

## Before you run anything

```bash
export NODARO_API_KEY=...                      # never on the command line — it lands in shell history
export NODARO_BASE_URL=https://next.nodaro.ai  # staging; production is https://app.nodaro.ai
```

Those two environment variables are the **only** source of credentials. The CLI
profiles under `~/.config/nodaro/` are deliberately not read — "it picked up a
profile I forgot about" is not a failure mode worth having on a harness that
bills.

Run it from a checkout **with its own `node_modules`**, on `dev`, and build the
workspace packages first:

```bash
npm install && npm run build:packages     # from the repository root
```

The harness resolves `@nodaro/sdk` through the workspace symlink. In a worktree
whose `node_modules` is symlinked to a sibling checkout, that resolves to the
*sibling's* `packages/client/dist` — a stale one fails with "not a function"
mid-run, after the quote and after the credits are committed. Check before a
paid run:

```bash
node -e "import('@nodaro/sdk').then(m=>{const c=m.createClient({baseUrl:'http://x',auth:new m.StaticTokenAuth('k')});
  console.log(typeof c.scene3d.quotePro, typeof c.scene3d.applyEdits, typeof c.jobs.cancel)})"
# three × "function"
```

`table-fixture` and `seedance-ab` decode video, so they need **ffmpeg and
ffprobe**. The harness looks in `$FFMPEG_PATH`/`$FFPROBE_PATH`, then
`/usr/local/bin` (where `tools/install-pinned-ffmpeg.sh` puts the pinned static
build), then `/opt/homebrew/bin`, then `PATH`, and records which binary produced
the numbers.

### Fixtures are fetched, not committed

The exact table prompt and the frozen A/B inputs are acceptance fixtures owned
by the **private planning repository**, alongside the acceptance specification
that grades them. This repository is publicly mirrored, so they are gitignored
here and fetched into place from your own checkout of it:

```bash
PLANNING=~/code/<your-planning-checkout>        # the private acceptance documents
mkdir -p tools/scene3d-acceptance/fixtures

# The table prompt is the fixture file the acceptance document links as the
# launch gate — copy it verbatim, it is a gate and not an example.
git -C "$PLANNING" show origin/main:<path/to/table-prompt.txt> \
  > tools/scene3d-acceptance/fixtures/table-prompt.txt

# The A/B's common prompt and its two frozen reference URLs are in the
# controlled-A/B document; copy the "Common prompt" paragraph into
# fixtures/ab-common-prompt.txt and pass the two URLs as --image-ref/--clay-ref.
```

## Exit codes

| Code | Meaning |
|---|---|
| `0` | every assertion passed |
| `1` | the run finished and an assertion **failed** — a real result, not an error |
| `2` | the harness itself broke (bad arguments, transport, a thrown error) |
| `3` | this deployment cannot serve what the probe measures — nothing was run |

Add `--dry-run` to any command to print the exact request bodies and exit
without touching the network or spending anything. Add `--help` for the full
option list.

## Staging first

Run these against `https://next.nodaro.ai`, in this order. Each one names the
plan-repo receipt it is expected to become.

```bash
E=tools/scene3d-acceptance/scene3d-acceptance.mjs
OUT=~/scene3d-receipts

# 1. Authoring with references, then the two things that must cost nothing.
#    → receipt: 2026-09-10-scene3d-astra-authoring-acceptance.json
node $E authoring --out $OUT \
  --prompt-file tools/scene3d-acceptance/fixtures/authoring-brief.txt \
  --ref 'https://cdn.nodaro.ai/…/appearance.png#appearance' \
  --ref 'https://cdn.nodaro.ai/…/layout.png#layout' \
  --motion-ref 'https://cdn.nodaro.ai/…/motion.mp4' \
  --repair-passes 2 --duration 10 --aspect 16:9

# 2. The full parent lifecycle, cancelled part-way.
#    → receipt: 2026-09-10-scene3d-parent-lifecycle.json
node $E lifecycle --out $OUT \
  --prompt-file tools/scene3d-acceptance/fixtures/authoring-brief.txt \
  --duration 10 --cancel-at processing --grace 120
# repeat with --cancel-at 45 (seconds) and --cancel-at <phase> for other points;
# a trigger that never fires is a FAILED assertion, not a quiet completion.

# 3. The launch gate: the exact table prompt at 720 frames.
#    → receipt: 2026-09-10-scene3d-table-fixture-720.json
node $E table-fixture --out $OUT --timeout-min 120
# re-judge an existing MP4 at a different tolerance, for free:
node $E table-fixture --out $OUT --video ~/downloads/table.mp4 --min-subject-area 0.001

# 4. The MCP-equivalent Basic lane on blender-cloud.
#    → receipt: 2026-09-10-scene3d-mcp-blender-cloud-v2.json
node $E blender-cloud-v2 --out $OUT \
  --prompt 'Blocking: a single grey table with two coloured boxes on it, one light. Slow push-in.' \
  --ref 'https://cdn.nodaro.ai/…/appearance.png#appearance' --duration 4

# 5. The controlled A/B, rerun with the scoping line.
#    → receipt: 2026-09-10-scene3d-seedance-ab-scoped.json
node $E seedance-ab --out $OUT \
  --prompt-file tools/scene3d-acceptance/fixtures/ab-common-prompt.txt \
  --image-ref '<the frozen image URL from the A/B document>' \
  --clay-ref '<the frozen clay video URL from the A/B document>'

# 6. Concurrency and timing.
#    → receipt: 2026-09-10-scene3d-linux-benchmark.json
node $E benchmark --out $OUT --users 1 --repeats 3 --fixture vehicle
node $E benchmark --out $OUT --users 2 --repeats 3 --fixture vehicle
node $E benchmark --out $OUT --users 4 --repeats 3 --fixture vehicle
node $E benchmark --out $OUT --users 2 --repeats 1 --fixture table --timeout-min 120
# `--fixture table` reads fixtures/table-prompt.txt — the same file the launch
# gate uses, so benchmarking "the table" cannot become a paraphrase of it.
```

## Then one production smoke

Production is currently the verification ground for this feature, but that is
not a reason to run the whole suite there. One short run is enough to
prove the lane is live on production, and it is the cheapest one:

```bash
NODARO_BASE_URL=https://app.nodaro.ai node tools/scene3d-acceptance/scene3d-acceptance.mjs \
  blender-cloud-v2 --out ~/scene3d-receipts \
  --prompt 'Blocking: a single grey table with two coloured boxes on it, one light. Slow push-in.' \
  --ref 'https://cdn.nodaro.ai/…/appearance.png#appearance' \
  --duration 4 --skip-render --label production-smoke
```

## Receipts

Every run writes `<out>/<subcommand>-<runId>.json`, rewritten after each
material step. It carries the inputs (prompts by digest, references and the
recorded command line by host and digest — never a credential, and never a
presigned URL's signature), the quote (`maxCredits`, the full `breakdown`,
`pricingVersion`, `capabilitiesVersion`), every job id and idempotency key,
per-phase timings from the **job's own timestamps**, credits and credit status,
output URLs by host, every assertion with expected/actual, and the verdict —
which is the conjunction of the assertions, never a separately maintained flag.
A run with no assertions is not a pass.

Receipts are safe to commit: they are secret-scanned before every write, and
the write is refused rather than truncated if anything credential-shaped is
found. **They belong in the private planning repository**, one JSON per paid
run, under its plans directory and named for the run:

```bash
cp ~/scene3d-receipts/table-fixture-<runId>.json \
   "$PLANNING"/<plans-dir>/2026-09-10-scene3d-table-fixture-720.json
```

A receipt that does not exist is a run that has not happened.

## What each probe asserts, and which SDK it uses

| Probe | Asserts | SDK surface |
|---|---|---|
| `authoring` | completion; scene plan **schemaVersion 2**; `sceneRevisionId`, `posterAssetId`, `validation.reportAssetId`, `renderer`, `metadata` present and matching the request; credits committed. Then a deterministic edit that **charges nothing** and mints a new revision, and a **render-only** re-run whose quote carries **no authoring line** and costs less than authoring. Records `validation.status`/warnings and the repair evidence. | `scene3d.capabilities`, `scene3d.quotePro`, `scene3d.runPro`, `scene3d.applyEdits` (v2) or `nodes.run("edit-3d-scene")` (v1), `jobs.getStatus`, `jobs.get`, `credits.balance` |
| `lifecycle` | one terminal state and no late change during a grace window; with `--cancel-at`: the trigger **fired**, the job ended cancelled or honestly failed, the reservation reads `refunded`, and **no output was published**. `--observe <jobId>` attaches to an existing job and checks single settlement + no duplicate delivery. | `scene3d.capabilities`, `scene3d.quotePro`, `scene3d.runPro`, `jobs.getStatus`, `jobs.cancel`, `jobs.get`, `credits.balance` |
| `table-fixture` | 1680×720, 24 fps, 720 frames; hard cuts at 360/432/492 as **spikes, not ramps** (the boundary must dominate both neighbours, with no blended frame); shot 1's two orbit fly-behinds; shot 2 blue shoulder + cyan subject; shot 3 yellow shoulder + red subject; shot 4 green foreground throughout with purple→cyan by the end. Records camera sway vs subject breathing as a heuristic. | `scene3d.capabilities`, `scene3d.quotePro`, `scene3d.runPro`, `jobs.getStatus`, `jobs.get`, `credits.balance` (+ ffmpeg/ffprobe) |
| `blender-cloud-v2` | `generate-3d-scene` with `engine: "blender-cloud"` and `acceptedSceneSchemaVersions: [2]` completes with a **retained v2 revision** carrying engine provenance; `edit-3d-scene` on the same engine produces a new revision naming its parent; `render-video` exports that revision to an MP4. | `nodes.run("generate-3d-scene" \| "edit-3d-scene" \| "render-video")`, `scene3d.capabilities`, `jobs.getStatus`, `jobs.get`, `credits.balance` |
| `seedance-ab` | arm B is arm A **plus the scoping line**; both arms complete; the **server-stored** `input_data` of the two jobs differs only in `prompt`, `userPrompt` and `referenceVideoUrls`; only arm B carries a reference video. The red-segmentation timing (central absence window, visible-at-end) is recorded as a comparison table — supporting evidence, not a verdict. | `nodes.run("generate-video")`, `jobs.getStatus`, `jobs.get` (for `input_data` parity), `credits.balance` (+ ffmpeg/ffprobe) |
| `benchmark` | every run completed and reported its own server timestamps. Produces per-run phase timings, per-repeat wall clock and p50/p95 over queue/work/total, plus a `server` block left **empty** for the builder-side metrics a client cannot see. | `scene3d.capabilities`, `scene3d.quotePro`, `scene3d.runPro`, `jobs.getStatus`, `jobs.get`, `credits.balance` |

The scoping line arm B adds is taken from `@nodaro/prompts`
(`SCENE3D_LAYOUT_REFERENCE_SCOPING_LINE`) when that export exists; otherwise
from `--scoping-line`, otherwise from a default that names what the reference
**is** for (exact layout, camera motion, trajectory, timing, occlusion) and what
it is **not** for (the clay look, flat colours, materials, lighting). The
receipt always records which of the three was used — an A/B whose only variable
is a sentence is worthless if nobody can tell which sentence ran.

## Self-tests

The pure halves — receipt schema, cut detection, colour segmentation and the
fixture verdict, input parity, argument parsing — are covered by
`tools/__tests__/scene3d-acceptance-*.test.mjs` and run in CI on a **bare
checkout with no `npm ci`**:

```bash
node --test tools/__tests__/scene3d-acceptance-*.test.mjs
```

That is why every module here imports only `node:` builtins and its siblings,
and reaches `@nodaro/sdk` and `@nodaro/prompts` through a dynamic import inside
a function. A guard test fails the build if that ever stops being true.
