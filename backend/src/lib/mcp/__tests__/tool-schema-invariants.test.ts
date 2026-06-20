import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { captureMcpToolSchemas } from "../../../../scripts/lib/gen-skills/capture-mcp-schemas.js"
import { ALL_SCOPES } from "../../scopes.js"

/**
 * Invariant guards for two recurring MCP bug classes the audit kept finding:
 *  (d) structuredContent ⊄ outputSchema  → strict clients (Cursor) reject results
 *  (c) registered tool not documented    → undocumented surface (creature/presets/etc.)
 *
 * These make the classes impossible to reintroduce: a new job verb with a
 * narrow outputSchema, or a new tool with no docs entry, fails CI.
 */
describe("MCP tool-schema invariants", () => {
  it("(d) every job-widget tool's outputSchema declares the keys widgetData emits (prompt + model)", async () => {
    const tools = await captureMcpToolSchemas(ALL_SCOPES)
    // A generation verb routes its result through jobResultWithWidget, whose
    // widgetData is `Omit<SingleJobStructuredContent,"jobId">` — it carries
    // `prompt` + `model`. zod-to-json-schema emits additionalProperties:false,
    // so such a tool whose outputSchema omits a key it emits is rejected by
    // strict clients (Cursor). We identify a "job-widget" schema as one whose
    // keys are ALL within the SingleJobStructuredContent superset (so read /
    // custom-shape tools like get_asset, voice_clone — which have non-superset
    // keys and emit their own matching shape — are correctly excluded).
    const SUPERSET = new Set([
      "jobId", "outputUrl", "prompt", "model",
      "aspectRatio", "resolution", "duration", "userDefaults",
    ])
    const offenders: string[] = []
    for (const t of tools) {
      const out = t.config.outputSchema as Record<string, unknown> | undefined
      if (!out || typeof out !== "object") continue
      const keys = Object.keys(out)
      if (!keys.includes("jobId")) continue // not a job-result tool
      if (!keys.every((k) => SUPERSET.has(k))) continue // custom shape, not a job-widget schema
      if (!keys.includes("prompt") || !keys.includes("model")) {
        offenders.push(`${t.name} (declares: ${keys.join(", ")})`)
      }
    }
    expect(
      offenders,
      `These job-widget tools emit prompt/model in structuredContent but omit them from ` +
        `outputSchema (strict clients reject). Use JOB_OUTPUT_SCHEMA:\n  ${offenders.join("\n  ")}`,
    ).toEqual([])
  })

  it("(c) every registered MCP tool is documented in docs/mcp/tools.md", async () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const docsPath = resolve(here, "../../../../../docs/mcp/tools.md")
    const docs = readFileSync(docsPath, "utf8")
    const tools = await captureMcpToolSchemas(ALL_SCOPES)

    const undocumented = tools
      .map((t) => t.name)
      .filter((name) => !docs.includes("`" + name + "`"))

    expect(
      undocumented,
      `These registered MCP tools are missing from docs/mcp/tools.md ` +
        `(public-docs-sync rule):\n  ${undocumented.join("\n  ")}`,
    ).toEqual([])
  })
})
