/**
 * The studio surface as the model actually receives it — built from the REAL
 * in-process tool server, not from a fixture of what we believe it serves.
 *
 * Three things are proved here and nowhere else:
 *
 *  1. THE PARTITION IS TOTAL. Every tool the model can see is either free or
 *     carries a class. A tool added to the studio family later joins the
 *     allowlist by derivation, so the only thing standing between it and a
 *     silent free pass is this test.
 *  2. QUOTABILITY IS DERIVED from the rendered schema — a tool is quotable
 *     when its `dry_run` is a plain boolean. Nothing is listed by hand, so a
 *     schema that renders its pin differently is caught rather than assumed.
 *  3. THE ONE DESCRIPTION OVERRIDE really drops the sentence it exists to
 *     drop, and the served description still carries it (otherwise the
 *     override would be a no-op nobody noticed).
 */
import { describe, expect, it, vi } from "vitest"
import Fastify from "fastify"
import type { Scope } from "../../../lib/scopes.js"
import { copilotSurface, isQuotable, STUDIO_EDIT_TOOL, STUDIO_PROPOSE_WITHOUT_MARK, STUDIO_READ_TOOLS, toDefinition } from "../surfaces.js"
import { buildToolSurface } from "../tools/registry.js"

vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../../lib/config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, hasCredits: () => true }
})
const { buildMcpServer } = await import("../../../lib/mcp/server.js")
const { createMcpInvoker } = await import("../../../lib/mcp/invoke.js")

const studio = copilotSurface("studio")

async function studioInvoker() {
  const server = await buildMcpServer({
    userId: "u1",
    scopes: [...studio.scopes] as Scope[],
    clientName: studio.clientName,
    fastify: Fastify(),
  })
  return createMcpInvoker(server)
}

function properties(schema: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return (schema.properties ?? {}) as Record<string, Record<string, unknown>>
}

describe("the model-visible studio surface", () => {
  it("serves every allowlisted tool and nothing else", async () => {
    const { definitions } = await buildToolSurface(await studioInvoker(), studio)
    const names = definitions.map((d) => d.name)
    expect([...names].sort()).toEqual([...studio.toolSurface].sort())
    expect(names).toEqual([...names].sort())
  })

  it("is partitioned — free, or classed, with nothing in two sets at once", async () => {
    const invoker = await studioInvoker()
    const { confirmClasses } = await buildToolSurface(invoker, studio)

    const free = new Set([...STUDIO_READ_TOOLS, "remember"])
    const marked = new Set(confirmClasses.keys())
    const edit = new Set([STUDIO_EDIT_TOOL])
    const proposed = new Set(STUDIO_PROPOSE_WITHOUT_MARK)

    const sets = [free, marked, edit, proposed]
    const union = new Set(sets.flatMap((s) => [...s]))
    expect([...union].sort()).toEqual([...studio.toolSurface].sort())

    // Pairwise disjoint: a tool classed twice is a tool whose confirmation
    // rule depends on which reader looked first.
    for (let i = 0; i < sets.length; i++) {
      for (let j = i + 1; j < sets.length; j++) {
        const overlap = [...sets[i]].filter((name) => sets[j].has(name))
        expect(overlap).toEqual([])
      }
    }

    // The marks are the ones the family stamps, read off the wire.
    for (const [, klass] of confirmClasses) expect(["$", "P"]).toContain(klass)
  })

  it("classes every spending tool of the family — none arrives unmarked", async () => {
    const { confirmClasses } = await buildToolSurface(await studioInvoker(), studio)
    for (const name of studio.toolSurface) {
      const classified =
        STUDIO_READ_TOOLS.has(name) ||
        name === "remember" ||
        name === STUDIO_EDIT_TOOL ||
        STUDIO_PROPOSE_WITHOUT_MARK.has(name) ||
        confirmClasses.has(name)
      expect(classified, `${name} is on the surface with no class`).toBe(true)
    }
  })
})

describe("quotability, derived from the rendered schema", () => {
  it("is true for a tool whose dry_run is a plain boolean", async () => {
    const invoker = await studioInvoker()
    const served = (await invoker.listTools()).find((t) => t.name === "generate_studio_still")!
    expect(properties(served.inputSchema).dry_run).toMatchObject({ type: "boolean" })
    expect(properties(served.inputSchema).dry_run.const).toBeUndefined()
    expect(properties(served.inputSchema).dry_run.enum).toBeUndefined()

    const { quotable } = await buildToolSurface(invoker, studio)
    expect(quotable.has("generate_studio_still")).toBe(true)
    expect(quotable.has("generate_studio_clip")).toBe(true)
  })

  it("is false for a tool whose dry_run is pinned to one value", async () => {
    const invoker = await studioInvoker()
    const served = (await invoker.listTools()).find((t) => t.name === "generate_studio_keyframe")!
    const dryRun = properties(served.inputSchema).dry_run
    // The pin renders as `const` or as a one-value `enum`, whichever the
    // converter emits. Either way it is not a plain boolean.
    const pinned = dryRun.const !== undefined || Array.isArray(dryRun.enum)
    expect(pinned, "the schema no longer pins dry_run — the derivation rule would go vacuous").toBe(true)

    const { quotable } = await buildToolSurface(invoker, studio)
    expect(quotable.has("generate_studio_keyframe")).toBe(false)
  })

  it("is false for a tool with no dry_run at all", async () => {
    const invoker = await studioInvoker()
    const served = (await invoker.listTools()).find((t) => t.name === "voice_studio_shot")!
    expect(properties(served.inputSchema).dry_run).toBeUndefined()

    const { quotable } = await buildToolSurface(invoker, studio)
    expect(quotable.has("voice_studio_shot")).toBe(false)
    expect(quotable.has("describe_studio_production")).toBe(false)
    expect(quotable.has("score_studio_production")).toBe(false)
  })
})

describe("the computed arguments are not the model's to choose", () => {
  it("are removed from the schema the model reads", async () => {
    const { definitions } = await buildToolSurface(await studioInvoker(), studio)
    const byName = new Map(definitions.map((d) => [d.name, d]))

    expect(properties(byName.get(STUDIO_EDIT_TOOL)!.input_schema).dry_run).toBeUndefined()
    expect(properties(byName.get(STUDIO_EDIT_TOOL)!.input_schema).expected_version).toBeUndefined()
    expect(properties(byName.get(STUDIO_EDIT_TOOL)!.input_schema).strict).toBeUndefined()
    expect(properties(byName.get("generate_studio_still")!.input_schema).dry_run).toBeUndefined()
    expect(properties(byName.get("generate_studio_clip")!.input_schema).dry_run).toBeUndefined()
    expect(properties(byName.get("describe_studio_production")!.input_schema).mode).toBeUndefined()
    expect(properties(byName.get("score_studio_production")!.input_schema).model).toBeUndefined()
    expect(properties(byName.get("get_studio_production")!.input_schema).reconcile).toBeUndefined()
  })

  it("leaves everything the model does choose in place", async () => {
    const { definitions } = await buildToolSurface(await studioInvoker(), studio)
    const byName = new Map(definitions.map((d) => [d.name, d]))
    expect(properties(byName.get(STUDIO_EDIT_TOOL)!.input_schema).ops).toBeDefined()
    expect(properties(byName.get("generate_studio_still")!.input_schema).shot_id).toBeDefined()
    expect(properties(byName.get("describe_studio_production")!.input_schema).brief).toBeDefined()
  })
})

describe("the one description override", () => {
  const RELOAD = "ask them to reload the editor"

  it("is not a no-op: the served description still carries the sentence", async () => {
    const invoker = await studioInvoker()
    const served = (await invoker.listTools()).find((t) => t.name === "import_studio_production")!
    expect(served.description).toContain(RELOAD)
  })

  it("drops it on the studio surface, and keeps the rest of the description", async () => {
    const { definitions } = await buildToolSurface(await studioInvoker(), studio)
    const imported = definitions.find((d) => d.name === "import_studio_production")!
    expect(imported.description).not.toContain(RELOAD)
    expect(imported.description).toContain("Add scenes")
    expect(imported.description.length).toBeGreaterThan(120)
  })
})

/**
 * The document write must be PREVIEWABLE by the same derivation the price
 * check uses, because the dispatcher fails closed on it: a served schema whose
 * preview flag does not read as a plain boolean means every studio edit is
 * refused as unavailable and nothing is ever proposed. Stub definitions cannot
 * prove that — only the schema this server actually renders can.
 */
describe("the document write offers a preview", () => {
  it("renders its preview flag as a plain boolean, which is what the dispatcher checks", async () => {
    const invoker = await studioInvoker()
    const served = (await invoker.listTools()).find((t) => t.name === STUDIO_EDIT_TOOL)!
    expect(properties(served.inputSchema).dry_run).toMatchObject({ type: "boolean" })
    expect(isQuotable(toDefinition(served)), "the edit tool would fail closed and propose nothing").toBe(true)
  })

  it("renders the read's landing flag as an ordinary boolean the surface can pin", async () => {
    const invoker = await studioInvoker()
    const served = (await invoker.listTools()).find((t) => t.name === "get_studio_production")!
    expect(properties(served.inputSchema).reconcile).toMatchObject({ type: "boolean" })
  })
})
