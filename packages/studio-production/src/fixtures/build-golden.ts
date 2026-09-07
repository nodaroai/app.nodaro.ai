/**
 * THE GOLDEN FIXTURES, BUILT — never hand-typed (plan P1.0, spec §11).
 *
 * `golden-production.json` is the one document two repos compare against: the
 * studio's client and the platform's `applyOps` must write the same bytes for
 * the same edits. A fixture typed by hand could only ever be a GUESS at what
 * the codec emits, and the first divergence would look like a bug in whichever
 * side was tested second. So the document is constructed with the codec's own
 * builders (`golden-document.ts`) and serialized through `serializeProduction`
 * — what lands on disk is, by construction, exactly what a save writes. The op
 * script beside it (`golden-script.ts`) is generated from the same values, so
 * every id it addresses is one the document really has.
 *
 * This module is the ENTRY POINT: the envelope, the settle-and-verify step, and
 * the writer. Run it with `npx tsx src/fixtures/build-golden.ts`; the drift
 * test in `__tests__/golden-fixture.test.ts` says when that is due.
 */
import { writeFileSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import { dirname, resolve } from "node:path"

import {
  parseProduction,
  type SerializedProduction,
  type StudioSettingsV3,
} from "../shot-graph"
import type { WorkflowLike } from "../workflow-like"

import { reserialize, serializeAuthored } from "./golden-document"
import { buildGoldenOps } from "./golden-script"

// The two the test imports through this entry point, so the fixture lane has
// ONE import path the way `shot-graph` is the codec's.
export { reserialize } from "./golden-document"
export { buildGoldenOps } from "./golden-script"

/** The fixture's envelope: a workflow row carrying the serialized production. */
export type GoldenWorkflow = WorkflowLike & {
  readonly nodes: SerializedProduction["nodes"]
  readonly edges: SerializedProduction["edges"]
  readonly settings: { readonly studio: StudioSettingsV3 }
}

const ROW = { id: "wf-golden", name: "The Golden Production" } as const

const envelope = (graph: SerializedProduction): GoldenWorkflow => ({
  ...ROW,
  nodes: graph.nodes,
  edges: graph.edges,
  settings: { studio: graph.settings.studio },
})

/** A stable, order-insensitive rendering — for comparing MEANING, not layout. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

/**
 * The fixture, settled onto the codec's own canonical key order.
 *
 * The authored objects are written for a reader; the parser rebuilds every one
 * of them in ITS field order, so the first serialize and the second differ in
 * LAYOUT. What must not differ is the CONTENT — a field the parser drops (a
 * lever off its scale, an off-grid beat window, a look id nothing reads back)
 * would quietly leave the fixture, and a fixture missing the very markers it
 * exists to pin would still pass a round-trip test. So the two are compared by
 * meaning and the build fails loudly when they disagree; only the layout is
 * allowed to move, and the third serialize proves it has stopped moving.
 */
export function buildGoldenWorkflow(): GoldenWorkflow {
  const authored = serializeAuthored()
  const settled = reserialize(parseProduction(envelope(authored)))
  if (canonical(authored) !== canonical(settled)) {
    throw new Error(
      "golden fixture: the codec did not read back everything it was given — " +
        "a field was dropped on parse. Compare serializeAuthored() with its " +
        "round trip and fix the authored value, never this check.",
    )
  }
  const again = reserialize(parseProduction(envelope(settled)))
  if (JSON.stringify(settled) !== JSON.stringify(again)) {
    throw new Error("golden fixture: save → reload is not a fixpoint")
  }
  return envelope(settled)
}

// ── the writer ───────────────────────────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url))

/** Pretty JSON with a trailing newline — the shape every committed file has. */
const asFile = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

/** Render both fixtures to disk. Run: `npx tsx src/fixtures/build-golden.ts`. */
export function main(): void {
  writeFileSync(
    resolve(HERE, "golden-production.json"),
    asFile(buildGoldenWorkflow()),
  )
  writeFileSync(resolve(HERE, "golden-ops.json"), asFile(buildGoldenOps()))
}

const invoked = process.argv[1]
if (invoked && import.meta.url === pathToFileURL(invoked).href) main()
