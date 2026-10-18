// tools/__tests__/units-scaffold.test.mjs
// `npm run gen:units -- --new` (tools/units/scaffold.mjs): flags, refusals,
// and a scaffold of every execution.kind into a copy of the fixture tree that
// validates and leaves `gen:units --check` clean. Never touches the real
// tree: the real repo is only READ, to prove which kinds it accepts today.
// The TypeScript-side checks (G2, G5, G7 on the scaffolded modules, the real
// price reader) are frontend/src/__tests__/units-scaffold.test.ts.
// @test-watches tools/units/** frontend/src/lib/node-families.ts frontend/src/lib/node-options.tsx frontend/src/lib/*macro*.ts backend/src/ee/billing/credits.ts backend/src/providers/video/__characterization__/operations.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { main } from "../units/gen.mjs"
import { loadUnits, repoContext } from "../units/manifest.mjs"
import { ALL_SEAM_IDS, liveSeams } from "../units/seams.mjs"
import { nextSteps, parseScaffoldArgs, planScaffold, scaffoldFiles, scaffoldMain, scaffoldOptions } from "../units/scaffold.mjs"
import { typesTs } from "../units/scaffold-templates.mjs"

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const FIXTURE = path.join(REPO, "tools/units/__fixtures__/tree")

function tree() {
  const dir = mkdtempSync(path.join(tmpdir(), "units-scaffold-"))
  cpSync(FIXTURE, dir, { recursive: true })
  return dir
}
// "scaffold": a second builder key for the use-case scaffold (fixture-case already
// builds with "fixture", and one spec builds one node type).
const ctxFor = (root) => ({
  legacyTypes: new Set(["text-prompt", "upload-video"]),
  families: new Set(["fixture-family"]),
  live: liveSeams(Object.fromEntries(ALL_SEAM_IDS.map((id) => [id, true]))),
  capabilities: {},
  useCaseBuilders: new Set(["fixture", "scaffold"]),
  exists: (p) => existsSync(path.join(root, p)),
})
const files = (root) => {
  const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : [path.relative(root, path.join(dir, n))]))
  return walk(root).sort()
}
const sink = () => {
  const lines = []
  return { lines, write: (s) => { lines.push(s) } }
}

/** The flags of a valid scaffold of `kind` into the fixture tree. */
const argsFor = (type, kind, extra = []) => [
  "--new", type, "--category", "processing", "--kind", kind, "--after", "upload-video",
  "--family", "fixture-family", "--picker-after", "first", "--description", `A ${kind} scaffold.`,
  ...(kind === "worker" || kind === "sync" || kind === "use-case" ? ["--price", "5"] : []),
  ...(kind === "use-case" ? ["--builder", "scaffold"] : []),
  ...extra,
]
const plan = (argv, root, ctx = ctxFor(root)) => planScaffold(parseScaffoldArgs(argv).opts, { root, ctx })

test("parseScaffoldArgs: `--flag value` and `--flag=value`; unknown, valueless and repeated flags are errors", () => {
  assert.deepEqual(parseScaffoldArgs(["--new", "a-b", "--label=A B", "--no-picker"]), { opts: { new: "a-b", label: "A B", "no-picker": true }, errors: [] })
  assert.deepEqual(parseScaffoldArgs(["--wat"]).errors, ["unknown argument --wat"])
  assert.deepEqual(parseScaffoldArgs(["--kind"]).errors, ["--kind needs a value"])
  assert.deepEqual(parseScaffoldArgs(["--kind", "--after", "x"]).errors, ["--kind needs a value", "unknown argument x"])
  assert.deepEqual(parseScaffoldArgs(["--kind", "a", "--kind", "b"]).errors, ["--kind is given twice"])
  assert.deepEqual(parseScaffoldArgs(["--no-picker=1"]).errors, ["--no-picker takes no value"])
})

test("scaffoldOptions: the place, the picker and the description are always stated; a route's price is never defaulted", () => {
  const errs = (argv) => scaffoldOptions(parseScaffoldArgs(argv).opts).errors
  const none = errs([])
  for (const f of ["--new", "--category", "--kind", "--after", "--description", "--family", "--picker-after"]) assert.ok(none.some((e) => e.startsWith(`${f} is required`)), f)
  assert.match(errs(argsFor("a-b", "worker").filter((a) => a !== "--price" && a !== "5")).join(), /--price is required for --kind worker/)
  assert.match(errs(argsFor("a-b", "sync").filter((a) => a !== "--price" && a !== "5")).join(), /--price is required for --kind sync/)
  assert.match(errs(argsFor("a-b", "use-case").filter((a) => a !== "--price" && a !== "5")).join(), /--price is required for --kind use-case: a run reserves its per-run fee, the price\.ee\.ts row "use-case-fee:a-b"/)
  assert.match(errs(argsFor("a-b", "inline", ["--price", "1"])).join(), /--price is only for --kind worker, sync or use-case/)
  assert.deepEqual(errs(argsFor("a-b", "use-case").filter((a) => a !== "--builder" && a !== "scaffold")), ["--builder is required for --kind use-case: its graph builder's key in packages/render-rules/src/use-case-specs.ts — write the builder first"])
  assert.match(errs(argsFor("a-b", "worker", ["--builder", "fixture"])).join(), /--builder is only for --kind use-case \(--kind worker runs no graph builder\)/)
  assert.equal(scaffoldOptions(parseScaffoldArgs(argsFor("a-b", "use-case")).opts).o.builder, "scaffold")
  assert.match(errs(argsFor("a-b", "worker").map((a) => (a === "5" ? "five" : a))).join(), /"five" is not a whole number of credits/)
  assert.match(errs(argsFor("a-b", "worker").map((a) => (a === "5" ? "1.5" : a))).join(), /"1\.5" is not a whole number of credits \(model_pricing\.credit_cost is an integer\)/)
  assert.match(errs(argsFor("a-b", "source", ["--no-picker"])).join(), /--no-picker excludes --family and --picker-after/)
  assert.match(errs(argsFor("A_b", "source")).join(), /not a kebab-case type id/)
  assert.match(errs(argsFor("a-b", "teleport")).join(), /--kind "teleport" is not one of/)
  assert.match(errs(argsFor("a-b", "inline", ["--characterize", "first"])).join(), /--characterize is only for --kind worker/)
  const { o, errors } = scaffoldOptions(parseScaffoldArgs(["--new", "echo-twice", "--category", "utility", "--kind", "source", "--after", "first", "--no-picker", "--description", "d"]).opts)
  assert.deepEqual(errors, [])
  assert.deepEqual(o, { type: "echo-twice", category: "utility", kind: "source", label: "Echo Twice", description: "d", after: null, family: null, pickerAfter: null, price: null, characterizeAfter: undefined })
})

test("scaffoldFiles: the files each execution.kind requires, and option.tsx only for a picker entry", () => {
  const set = (kind, extra = {}) => [...scaffoldFiles({ type: "x-y", category: "processing", kind, label: "X Y", description: "d", after: null, family: "f", pickerAfter: null, price: kind === "worker" || kind === "sync" || kind === "use-case" ? 1 : null, ...(kind === "use-case" ? { builder: "b" } : {}), ...extra }).keys()].sort()
  const fe = (f) => `frontend/src/nodes/x-y/${f}`
  const be = (f) => `backend/src/nodes/x-y/${f}`
  assert.deepEqual(set("worker"), [be("payload.ts"), be("price.ee.ts"), be("route.ts"), be("worker.ts"), fe("api.ts"), fe("config.tsx"), fe("exec.ts"), fe("node.tsx"), fe("option.tsx"), fe("types.ts"), fe("unit.json")])
  assert.deepEqual(set("sync"), [be("price.ee.ts"), be("route.ts"), fe("api.ts"), fe("config.tsx"), fe("exec.ts"), fe("node.tsx"), fe("option.tsx"), fe("types.ts"), fe("unit.json")])
  assert.deepEqual(set("inline"), [fe("config.tsx"), fe("exec.ts"), fe("node.tsx"), fe("option.tsx"), fe("types.ts"), fe("unit.json")])
  assert.deepEqual(set("source", { family: null }), [fe("config.tsx"), fe("node.tsx"), fe("types.ts"), fe("unit.json")])
  // use-case: no exec.ts, api.ts or route — executeUseCase and the factory route run it; its fee row and body.
  assert.deepEqual(set("use-case"), [be("price.ee.ts"), be("use-case.ts"), fe("config.tsx"), fe("node.tsx"), fe("option.tsx"), fe("types.ts"), fe("unit.json")])
  const useCase = scaffoldFiles({ type: "x-y", category: "processing", kind: "use-case", label: "X Y", description: "d", after: null, family: "f", pickerAfter: null, price: 10, builder: "b" })
  const manifest = JSON.parse(useCase.get(fe("unit.json")))
  assert.deepEqual(manifest.execution, { kind: "use-case", builder: "b" })
  assert.deepEqual(manifest.contract, { jsonPips: { json: "other" } })
  assert.match(useCase.get(be("price.ee.ts")), /export const staticCosts = \{ "use-case-fee:x-y": 10 \} as const\n\nexport const price: UnitPrice = \{ staticCosts, creditId: \(\) => "use-case-fee:x-y" \}/)
  // The recording pip takes video and audio: the media rule; the JSON pip is a look pip.
  assert.match(useCase.get(fe("node.tsx")), /handleId="media" [^\n]*accepts=\{ACCEPTS_MEDIA\}/)
  assert.match(useCase.get(fe("node.tsx")), /handleId="json" [^\n]*color=\{DATA_HANDLE_COLORS\.json\} icon=\{<Braces \/>\}/)
  assert.match(useCase.get(fe("node.tsx")), /nodeData\.generatedText/)
  assert.doesNotMatch(useCase.get(fe("node.tsx")), /nodeData\.undefined/)
  // --characterize: the worker's ffmpeg characterization, and the ffmpeg-media capability it needs.
  const characterized = scaffoldFiles({ type: "x-y", category: "processing", kind: "worker", label: "X Y", description: "d", after: null, family: "f", pickerAfter: null, price: 1, characterizeAfter: "op" })
  assert.match(characterized.get(be("characterize.char.ts")), /after: "op",/)
  assert.deepEqual(JSON.parse(characterized.get(fe("unit.json"))).capabilities, ["ffmpeg-media"])
  assert.deepEqual(JSON.parse(scaffoldFiles({ type: "x-y", category: "processing", kind: "worker", label: "X Y", description: "d", after: null, family: "f", pickerAfter: null, price: 1 }).get(fe("unit.json"))).capabilities, [])
})

for (const kind of ["worker", "sync", "inline", "source", "use-case"]) {
  test(`--new --kind ${kind} into the fixture tree: valid beside fixture-echo, and gen:units --check is clean`, async () => {
    const root = tree()
    try {
      const type = `scaffold-${kind}`
      assert.deepEqual(plan(argsFor(type, kind), root).errors, [])
      const ctx = ctxFor(root)
      // Each price.ee.ts's own rows (the projection carries every row of the unit's file).
      const readPrice = (rel) => ({ "fixture-echo": { "fixture-echo": 3 }, "fixture-case": { "use-case-fee:fixture-case": 1 } })[rel.split("/").at(-2)] ?? { [kind === "use-case" ? `use-case-fee:${type}` : type]: 5 }
      const out = sink()
      const err = sink()
      assert.equal(await main(argsFor(type, kind), root, out, err, { ctx, readPrice }), 0, err.lines.join(""))
      assert.match(out.lines.join(""), new RegExp(`wrote \\d+ file\\(s\\) for "${type}"`))
      assert.deepEqual(loadUnits(root).map((u) => u.type), ["fixture-case", "fixture-echo", type])
      const check = sink()
      assert.equal(await main(["--check"], root, sink(), check, { ctx, readPrice }), 0, check.lines.join(""))
      assert.match(readFileSync(path.join(root, "frontend/src/nodes/_generated/definitions.ts"), "utf8"), new RegExp(`\\| "${type}" // unit:${type}`))
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
}

test("refusals write nothing: a legacy type, an existing unit, an unknown family or place, a bad category", async () => {
  const root = tree()
  try {
    const before = files(root)
    const refused = (argv) => plan(argv, root).errors.join("\n")
    assert.match(refused(argsFor("upload-video", "source")), /is also a legacy node/)
    assert.match(refused(argsFor("fixture-echo", "source")), /frontend\/src\/nodes\/fixture-echo and backend\/src\/nodes\/fixture-echo already exist — --new never overwrites/)
    assert.match(refused(argsFor("new-one", "source").map((a) => (a === "fixture-family" ? "no-such-family" : a))), /picker\.family "no-such-family" is not a family id/)
    assert.match(refused(argsFor("new-one", "source").map((a) => (a === "upload-video" ? "no-such-type" : a))), /position\.after: "no-such-type" is not a node type/)
    assert.match(refused(argsFor("new-one", "source").map((a) => (a === "processing" ? "ai" : a))), /category "ai" has no \/v1\/nodes category yet/)
    const err = sink()
    assert.equal(await main(argsFor("upload-video", "source"), root, sink(), err, { ctx: ctxFor(root) }), 1)
    assert.match(err.lines.join(""), /refused, nothing written/)
    assert.equal(await main(["--new", "x-y", "--wat"], root, sink(), sink(), { ctx: ctxFor(root) }), 2)
    assert.deepEqual(files(root), before, "a refused scaffold leaves the tree untouched")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("the real repo today: a worker unit scaffolds; sync, inline and source wait for their server seam", () => {
  const real = (kind) => planScaffold(parseScaffoldArgs([
    "--new", "scaffold-probe", "--category", "processing", "--kind", kind, "--after", "remove-audio",
    "--family", "video-sound", "--picker-after", "remove-audio", "--description", "A probe.",
    ...(kind === "worker" || kind === "sync" ? ["--price", "1"] : []),
  ]).opts, { root: REPO })
  assert.deepEqual(real("worker").errors, [])
  const characterize = (op) => planScaffold(parseScaffoldArgs(["--new", "scaffold-probe", "--category", "processing", "--kind", "worker", "--after", "remove-audio",
    "--family", "video-sound", "--picker-after", "remove-audio", "--description", "A probe.", "--price", "1", "--characterize", op]).opts, { root: REPO }).errors
  assert.deepEqual(characterize("remove-audio"), [], "a unit's own characterization is an operation to follow")
  assert.deepEqual(characterize("first"), [])
  assert.match(characterize("no-such-op").join("\n"), /"no-such-op" is not a characterization operation/)
  // Names no legacy node has but a composer's wider table does: refused before anything is written.
  const named = (type, why) => {
    const errors = planScaffold(parseScaffoldArgs(["--new", type, "--category", "processing", "--kind", "worker", "--after", "remove-audio",
      "--family", "video-sound", "--picker-after", "remove-audio", "--description", "A probe.", "--price", "1"]).opts, { root: REPO }).errors.join("\n")
    assert.match(errors, new RegExp(`"${type}" is reserved: .*${why}`), type)
  }
  named("constructor", "Object\\.prototype")
  named("reframe", "canvas macro")
  named("ai-writer", "credit id")
  named("seedance-2", "credit id")
  const crossFamily = planScaffold(parseScaffoldArgs(["--new", "scaffold-probe", "--category", "processing", "--kind", "worker", "--after", "remove-audio",
    "--family", "video-sound", "--picker-after", "text-prompt", "--description", "A probe.", "--price", "1"]).opts, { root: REPO }).errors.join("\n")
  assert.match(crossFamily, /picker\.after: "text-prompt" is not in family "video-sound"/)
  for (const kind of ["sync", "inline", "source"]) {
    assert.match(real(kind).errors.join("\n"), new RegExp(`execution\\.kind "${kind}" \\(a server-run workflow cannot run it: .*\\) needs the "run-${kind}" seam, which is not live`), kind)
  }
})

// The fee rows "use-case-fee:<type>" are credit ids, never type ids, so they
// reserve nothing; only a CREDIT_COSTS resolver keyed by the bare type did
// (deleted for the two nodes not on dev, decided 2026-10-18). Asserted on the
// reserved message only, so another refusal cannot mask it.
const reservedOf = (errors, type) => errors.filter((e) => e.includes(`"${type}" is reserved`))

test("clip-pack and episode-trailer are free type ids (their fee rows reserve nothing)", () => {
  const plan = (type) => planScaffold(parseScaffoldArgs(["--new", type, "--category", "processing", "--kind", "worker", "--after", "remove-audio",
    "--family", "video-sound", "--picker-after", "remove-audio", "--description", "A probe.", "--price", "1"]).opts, { root: REPO }).errors
  // The control: the same arguments do reach the reserved check — a credit-id
  // type is refused — so the empty answers below are not vacuous.
  assert.match(reservedOf(plan("ai-writer"), "ai-writer").join("\n"), /"ai-writer" is reserved: .*credit id/)
  for (const type of ["clip-pack", "episode-trailer"]) assert.deepEqual(reservedOf(plan(type), type), [], type)
})

// The reserved id is the control: it proves the plan reached the validator
// (an unknown --builder would stop it at the flags, and the clip-pack
// assertion would pass vacuously).
test("a use-case unit may be born clip-pack (no reserved refusal)", () => {
  const useCase = (type) => planScaffold(parseScaffoldArgs(["--new", type, "--kind", "use-case", "--builder", "fixture", "--price", "10",
    "--category", "processing", "--after", "apply-edl", "--family", "video-sound", "--picker-after", "remove-audio", "--description", "A probe."]).opts,
  { root: REPO, ctx: { ...repoContext(REPO), useCaseBuilders: new Set([...repoContext(REPO).useCaseBuilders, "fixture"]) } }).errors
  assert.match(reservedOf(useCase("ai-writer"), "ai-writer").join("\n"), /"ai-writer" is reserved: .*credit id/)
  assert.deepEqual(reservedOf(useCase("clip-pack"), "clip-pack"), [])
})

test("the real repo: a use-case --builder must name a spec no node builds yet", () => {
  const plan = (builder, ctx) => planScaffold(parseScaffoldArgs(["--new", "scaffold-probe", "--kind", "use-case", "--builder", builder, "--price", "10",
    "--category", "processing", "--after", "apply-edl", "--family", "video-sound", "--picker-after", "remove-audio", "--description", "A probe."]).opts, { root: REPO, ...(ctx ? { ctx } : {}) }).errors
  const useCase = (builder) => plan(builder).join("\n")
  // A spec no node builds: the whole plan validates against the real repo — its
  // price.ee.ts read from the plan (nothing is written yet), so its creditId is found.
  const real = repoContext(REPO)
  assert.deepEqual(plan("fixture", { ...real, useCaseBuilders: new Set([...real.useCaseBuilders, "fixture"]) }), [])
  assert.match(useCase("no-such-builder"), /execution\.builder "no-such-builder" is not a use-case spec in packages\/render-rules\/src\/use-case-specs\.ts — write its builder first/)
  // A builder another unit already names (every real use-case unit's) is refused.
  const named = loadUnits(REPO).filter((u) => u.manifest?.execution?.kind === "use-case")
  assert.ok(named.length > 0, "the repo has a use-case unit whose builder is taken")
  for (const u of named) {
    const builder = u.manifest.execution.builder
    const want = `${u.type}, scaffold-probe: execution.builder "${builder}" is named by more than one unit — one use-case spec builds one node type`
    assert.ok(useCase(builder).includes(want), `${u.type}: ${useCase(builder)}`)
  }
})

test("a failed regeneration removes the folders it wrote, so the next run is not refused", async () => {
  const root = tree()
  try {
    const before = files(root)
    let calls = 0
    const err = sink()
    const rc = await scaffoldMain(argsFor("regen-fails", "source"), { root, out: sink(), err, ctx: ctxFor(root), generateAndWrite: async () => (calls++ === 0 ? 1 : 0) })
    assert.equal(rc, 1)
    assert.equal(calls, 2, "regenerated again without the new folders")
    assert.match(err.lines.join(""), /the "regen-fails" folders were removed again/)
    assert.deepEqual(files(root), before)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("a regeneration that THROWS also removes the folders it wrote", async () => {
  const root = tree()
  try {
    const before = files(root)
    let calls = 0
    await assert.rejects(scaffoldMain(argsFor("regen-throws", "source"), { root, out: sink(), err: sink(), ctx: ctxFor(root), generateAndWrite: async () => { if (calls++ === 0) throw new Error("boom"); return 0 } }), /boom/)
    assert.deepEqual(files(root), before)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("a label cannot close the JSDoc of types.ts", () => {
  assert.match(typesTs({ type: "a-b", category: "processing", kind: "source", label: "A */ B" }), /\/\*\* A \*\\\/ B: /)
})

test("nextSteps for a use-case node: its builder, its body, its MCP verb, its settings table, its fee row's seed, its docs, a shared changeset", () => {
  const steps = nextSteps({ type: "x-y", category: "processing", kind: "use-case", label: "X Y", description: "d", after: null, family: null, pickerAfter: null, price: 10, builder: "clips" })
  const at = (re) => steps.findIndex((s) => re.test(s))
  const order = [/USE_CASE_SPECS\.clips/, /use-case\.ts's body .*`settingKeys` in its spec/, /REGISTER_BY_BUILDER entry for "clips" in backend\/src\/lib\/mcp\/tools\/verbs-use-case\.ts/, /SETTINGS_TABLES row for "x-y"/, /model_pricing[\s\S]*"use-case-fee:x-y" at the same 10 credits/, /docs\/nodes\/<folder>\/x-y\.md/, /@nodaro\/shared changeset \(the use-case list and contract rows are published/]
  for (const re of order) assert.ok(at(re) >= 0, `${re}: ${steps.join("\n")}`)
  assert.deepEqual(order.map(at), [...order.map(at)].sort((a, b) => a - b), "in that order")
  assert.doesNotMatch(steps.join("\n"), /is not written yet/)
})

test("nextSteps names the deliberately central steps (the price migration only for a node with a route)", () => {
  const steps = (kind, price) => nextSteps({ type: "x-y", category: "processing", kind, label: "X Y", description: "d", after: null, family: null, pickerAfter: null, price }).join("\n")
  assert.match(steps("worker", 5), /model_pricing[\s\S]*"x-y" at the same 5 credits/)
  assert.match(steps("worker", 5), /@nodaro\/shared changeset/)
  assert.doesNotMatch(steps("source", null), /model_pricing|changeset/)
  for (const s of ["strings.json", "docs.awaiting", "build:packages"]) assert.match(steps("source", null), new RegExp(s.replace(".", "\\.")))
  // gen:skills reads the built packages, and writes render-rules' settings table: build before and after it.
  assert.match(steps("source", null), /npm run build:packages \(.*\), npm run gen \(.*\), npm run build:packages again .*npm run typecheck/)
})
