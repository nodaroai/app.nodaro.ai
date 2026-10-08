import { describe, it, expect } from "vitest"
import { RENDER_NODE_TYPES, declaredJsonOutput, declaredJsonOutputRows } from "@nodaro/shared"
import { NODE_DEFINITIONS, NODE_DEF_MAP } from "@/types/nodes"
import { HANDLE_OUTPUT_TYPES } from "../handle-output-types"

/**
 * Every node with a JSON output declares its JSON kind (decided 2026-10-08):
 * `transcript`, `edl`, or `other`, in the json-kinds table
 * (`packages/shared/src/json-kinds.ts`; a render node's `json` pip declares it in
 * the render registry instead).
 *
 * Why this is a guard and not a list to remember: the EDL/Transcript connection
 * block can only judge a pip it has a declaration for. A node that produced a
 * Transcript and was never declared (Text to Dialogue was one) slips past the
 * block, and the mistake surfaces at run time as a captionless render.
 *
 * What counts as a JSON output pip: a source handle drawn as the data (`look`)
 * pip or the picker-JSON pip (`HANDLE_OUTPUT_TYPES`, itself pinned to the JSX by
 * handle-color-guard.test.ts), or any handle named `json`. Runtime-typed pass-
 * through pips (`out`, `route_*`, `media`) and control-coloured trigger payloads
 * are not JSON pips by this definition and are out of scope.
 */
const JSON_PIP_COLORS: ReadonlySet<string> = new Set(["look", "pickerJson"])

const jsonPips: Array<[string, string]> = NODE_DEFINITIONS.flatMap((def) =>
  def.outputs
    .filter((h) => h === "json" || JSON_PIP_COLORS.has(HANDLE_OUTPUT_TYPES[def.type]?.[h] ?? ""))
    .map((h): [string, string] => [def.type, h]),
)

describe("every JSON output pip declares transcript | edl | other", () => {
  it("finds the JSON pips it is meant to guard", () => {
    // A rename of the colour or of the handle must not silently empty the guard.
    const keys = jsonPips.map(([t, h]) => `${t}.${h}`)
    for (const k of ["transcribe.json", "text-to-dialogue.json", "apply-edl.json", "speaker-view.json", "edit-plan.edl", "camera-switch.transcript", "web-scrape.json", "forced-alignment.data"]) {
      expect(keys).toContain(k)
    }
  })

  it.each(jsonPips)("%s.%s", (type, handle) => {
    expect(
      declaredJsonOutput(type, handle),
      `${type}.${handle} is a JSON output with no declaration — add a row to JSON_OUTPUT_KINDS in packages/shared/src/json-kinds.ts ` +
        `(transcript | edl | other), or set jsonKind on its render-node registry entry`,
    ).toBeDefined()
  })

  it("every render node's json pip is a real output of the node and answers its registry kind", () => {
    for (const type of Object.keys(RENDER_NODE_TYPES)) {
      expect(NODE_DEF_MAP.get(type)?.outputs, type).toContain("json")
      expect(declaredJsonOutput(type, "json"), type).toBe(RENDER_NODE_TYPES[type]!.jsonKind)
    }
  })
})

describe("the json-kinds table carries no stale row", () => {
  it.each(declaredJsonOutputRows().map(([t, h, k]) => [t, h, k] as [string, string, string]))("%s.%s (%s) is an output of its node", (type, handle) => {
    const def = NODE_DEF_MAP.get(type)
    expect(def, `${type} has no node definition`).toBeDefined()
    expect(def!.outputs, `${type} has no output pip ${handle}`).toContain(handle)
    // ...and the guard above sees it, so a declaration can never sit on a pip the enumeration would not check.
    expect(jsonPips.map(([t, h]) => `${t}.${h}`)).toContain(`${type}.${handle}`)
  })
})
