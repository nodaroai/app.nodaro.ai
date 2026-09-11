// Argument parsing for the six probes.
//
// The tables are DATA, and these tests drive exactly the parser the CLI does.
// The refusals matter more than the successes: every one of them is a paid run
// that does NOT start against a body the route would reject after quoting.
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  COMMON_OPTIONS, SUBCOMMANDS, optionTable, parseCancelAt, parseReference,
  parseSubcommandArgs, toInt, toNumber, topUsage, usage,
} from "../scene3d-acceptance/lib/args.mjs"

test("every subcommand has a summary and inherits the common options", () => {
  assert.deepEqual(Object.keys(SUBCOMMANDS), ["authoring", "lifecycle", "table-fixture", "blender-cloud-v2", "seedance-ab", "benchmark"])
  for (const [name, entry] of Object.entries(SUBCOMMANDS)) {
    assert.equal(typeof entry.summary, "string", `${name} has no summary`)
    const table = optionTable(name)
    for (const common of Object.keys(COMMON_OPTIONS)) assert.ok(common in table, `${name} is missing --${common}`)
  }
  assert.throws(() => optionTable("nope"), /unknown subcommand/)
})

test("common options coerce into the shape the harness runs on", () => {
  const parsed = parseSubcommandArgs("authoring", ["--out", "/tmp/r", "--timeout-min", "5", "--poll-ms", "500", "--label", "staging"])
  assert.equal(parsed.out, "/tmp/r")
  assert.equal(parsed.timeoutMs, 5 * 60_000)
  assert.equal(parsed.pollMs, 500)
  assert.equal(parsed.label, "staging")
  assert.equal(parsed.dryRun, false)
})

test("defaults are the frozen fixture's settings where the fixture has one", () => {
  const table = parseSubcommandArgs("table-fixture", [])
  assert.equal(table.values.duration, "30")
  assert.equal(table.values.fps, "24")
  assert.equal(table.values.aspect, "21:9")
  assert.equal(table.values["repair-passes"], "2")
  const ab = parseSubcommandArgs("seedance-ab", [])
  assert.equal(ab.values.provider, "seedance-2-5")
  assert.equal(ab.values.duration, "4")
  assert.equal(ab.values.resolution, "480p")
  assert.equal(ab.values.aspect, "16:9")
  assert.equal(ab.values.sound, false, "the frozen A/B is sound off")
})

test("an unknown flag is refused rather than ignored", () => {
  assert.throws(() => parseSubcommandArgs("authoring", ["--reff", "x"]), /Unknown option/)
})

test("--ref is repeatable and carries its role in the URL fragment", () => {
  const parsed = parseSubcommandArgs("authoring", ["--ref", "https://a.test/1.png#appearance", "--ref", "https://a.test/2.png#layout"])
  assert.deepEqual(parsed.values.ref, ["https://a.test/1.png#appearance", "https://a.test/2.png#layout"])
})

test("a reference defaults to appearance and keeps a fragmentless URL whole", () => {
  assert.deepEqual(parseReference("https://a.test/1.png", 0), { id: "ref-0", kind: "image", role: "appearance", url: "https://a.test/1.png" })
  assert.equal(parseReference("https://a.test/1.png#layout", 1).role, "layout")
  assert.equal(parseReference("https://a.test/clip.mp4#motion", 2, { kind: "video" }).kind, "video")
})

test("an unknown reference role is refused HERE, before anything is quoted", () => {
  assert.throws(() => parseReference("https://a.test/1.png#style", 0), /role must be one of/)
  assert.throws(() => parseReference("ftp://a.test/1.png", 0), /must be http/)
  assert.throws(() => parseReference("/local/file.png", 0), /must be http/)
})

test("--cancel-at accepts a status, a phase, a progress mark and a deadline", () => {
  assert.deepEqual(parseCancelAt("processing"), { kind: "status", status: "processing" })
  assert.deepEqual(parseCancelAt("pending_review"), { kind: "status", status: "pending_review" })
  assert.deepEqual(parseCancelAt("progress:40"), { kind: "progress", progress: 40 })
  assert.deepEqual(parseCancelAt("90"), { kind: "seconds", seconds: 90 })
  assert.deepEqual(parseCancelAt("90s"), { kind: "seconds", seconds: 90 })
  assert.deepEqual(parseCancelAt("rendering"), { kind: "phase", name: "rendering" })
  assert.equal(parseCancelAt(undefined), null)
  assert.equal(parseCancelAt(""), null)
  assert.throws(() => parseCancelAt("half way through!"), /--cancel-at must be/)
})

test("integer and number coercion refuse what a route would reject", () => {
  assert.equal(toInt("24", "fps"), 24)
  assert.equal(toInt(undefined, "fps"), undefined)
  assert.throws(() => toInt("24.5", "fps"), /must be an integer/)
  assert.throws(() => toInt("0", "fps", { min: 1 }), /must be >= 1/)
  assert.throws(() => toInt("3", "repair-passes", { max: 2 }), /must be <= 2/)
  assert.equal(toNumber("4.5", "duration"), 4.5)
  assert.throws(() => toNumber("soon", "duration"), /must be a number/)
})

test("usage names the subcommand's options and never a credential", () => {
  const text = usage("seedance-ab")
  assert.ok(text.includes("--scoping-line"))
  assert.ok(text.includes("--out"))
  assert.ok(text.includes("NODARO_API_KEY"))
  assert.equal(/ndr_/.test(text), false)
  for (const name of Object.keys(SUBCOMMANDS)) assert.ok(topUsage().includes(name))
})
