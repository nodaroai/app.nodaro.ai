// @test-watches backend/src/**/*.ts
/**
 * ONE resolver, BOTH lanes. A generate-image run can name the caller's palette
 * or moodboard (`direction.colorLook: "palette:<id>"`, `direction.style:
 * "moodboard:<id>"`) from two doors — the route (`POST /v1/generate-image`,
 * which the SDK, the CLI and MCP's generate_image all reach) and a workflow
 * run's Generate Image node. If either door resolved on its own, a single-node
 * run and a workflow run of the same node would fold different clauses, send
 * different references and be priced differently. Behaviour is pinned by each
 * lane's own suite; this pins the WIRING, which a behaviour test of one lane
 * cannot see:
 *
 *  - the route resolves in a preHandler that runs AFTER the preset is applied
 *    (it rewrites the body into the one that runs) and BEFORE the credit guard
 *    (a moodboard's images are references, and references price the run), and
 *    both the guard's identifier and the handler's assembly read that one
 *    resolution;
 *  - a preset call (REST `presetId`, MCP generate_image `presetId`) folds its
 *    direction in a synchronous build that cannot read the caller's rows, so a
 *    palette or moodboard there — the caller's or saved in the preset — is
 *    refused, not dropped;
 *  - the workflow lane resolves in the node executor, through the same
 *    `resolveUserDirection`, before any jobs row, and hands it to BOTH of the
 *    builder's assembly branches;
 *  - the routes that cannot use one refuse it rather than ignore it;
 *  - nothing else in the backend reads a palette or a moodboard: the CRUD
 *    routes and the resolver are the only readers of their tables.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const SRC = join(__dirname, "..", "..")
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8")

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : walk(p)
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [p] : []
  })
}

describe("the route lane", () => {
  const route = read("routes/generate-image.ts")
  // Each job is planned (assembled, snapped, priced) in the planner module —
  // once per model of a batch; the route file keeps the CHECK and the handler.
  const planner = read("routes/generate-image-plan.ts")

  it("resolves the caller's palette / moodboard on the body that runs, before the credit guard prices it", () => {
    // (`replayImageBatch` first: a keyed batch repeated is answered from its jobs.)
    expect(route).toMatch(
      /preHandler:\s*\[\s*replayImageBatch\s*,\s*applyGenerateImagePreset\s*,\s*userDirectionPreHandler\s*,\s*creditGuard\(resolveImageCreditIdentifier, \{ batchIdentifiers: resolveImageBatchCreditIdentifiers \}\)\s*,?\s*\]/,
    )
  })

  it("prices (the guard's identifier) and assembles (the handler) from that one resolution", () => {
    // The credit CHECK lives in its own module (the route imports it).
    const pricing = read("routes/generate-image-credit-id.ts")
    expect(pricing).toContain("userDirectionOf(req)")
    expect(pricing).toMatch(/assembledRefCountForPricing\([^\n]*, userDirection\)/)
    const handler = route.slice(route.indexOf("export async function generateImageRoutes"))
    expect(handler).toContain("userDirectionOf(req)")
    expect(handler).toMatch(/assembleImageRequest\(request, structuredMode, userDirection\)/)
    expect(planner).toMatch(/buildAssembleInput\(data, true, userDirection\)/)
    // Every assembly is told about it (the builder takes it as a REQUIRED
    // argument, so a new call site cannot forget it in silence).
    expect(planner).toMatch(/userDirection: ResolvedUserDirection \| undefined,\r?\n\): AssembleImageInput/)
  })
})

describe("the workflow lane", () => {
  it("the node step resolves through the route's own resolver", () => {
    expect(read("services/workflow-engine/node-user-direction.ts")).toContain("resolveUserDirection(direction, ownersOf)")
  })

  it("the orchestrator records what the graph SAVED before the run's overrides land on it", () => {
    // A saved value resolves among the owner's rows, anything the run supplied
    // among the runner's: the record must be taken from the graph as loaded.
    const worker = read("workers/orchestrator-worker.ts")
    const recordAt = worker.indexOf("ctx.savedDirectionRefs = savedUserDirectionRefs(nodes)")
    const mergeAt = worker.indexOf("applyInputOverridesToNodes(", recordAt)
    expect(recordAt).toBeGreaterThan(-1)
    expect(mergeAt).toBeGreaterThan(recordAt)
    expect(worker.slice(recordAt, mergeAt)).not.toContain("inputOverrides[")
  })

  it("the node executor resolves before any jobs row and hands the result to the build", () => {
    const executor = read("services/workflow-engine/node-executor.ts")
    const resolveAt = executor.indexOf("await userDirectionForNode(node, ctx)")
    const insertAt = executor.indexOf('insertInternalJob("orchestrator"')
    expect(resolveAt).toBeGreaterThan(-1)
    expect(insertAt).toBeGreaterThan(resolveAt)
    expect(executor).toContain("...(userDirection ? { userDirection } : {})")
  })

  it("both of the builder's Generate Image assembly branches fold it", () => {
    const builder = read("services/workflow-engine/payload-builder.ts")
    const start = builder.indexOf('case "generate-image": {')
    const end = builder.indexOf('case "reference-board": {')
    const generateImage = builder.slice(start, end)
    expect(generateImage.match(/\.\.\.userDirectionLevers,/g)).toHaveLength(2)
    expect(generateImage).toContain("buildCtx?.userDirection")
  })
})

describe("the routes that cannot use one refuse it", () => {
  it.each(["routes/generate-video.ts", "routes/text-to-video.ts"])("%s answers 400 instead of folding nothing", (file) => {
    expect(read(file)).toContain("userDirectionNotSupported(parsed.data.direction)")
  })

  it("the preset build refuses one, and both preset doors answer the refusal", () => {
    expect(read("lib/presets/apply-image-preset.ts")).toMatch(
      /userDirectionRefKey\(direction\)[\s\S]{0,200}throw new PresetUserDirectionError/,
    )
    expect(read("lib/presets/generate-image-preset-hook.ts")).toContain("err instanceof PresetUserDirectionError")
    expect(read("lib/mcp/tools/_image-preset-call.ts")).toContain("err instanceof PresetUserDirectionError")
    // MCP's own palette_id / moodboard_id never reach the preset build at all.
    const verbs = read("lib/mcp/tools/verbs-image.ts")
    const presetBranch = verbs.slice(verbs.indexOf("if (args.presetId) {"), verbs.indexOf("presetImageBody(args"))
    expect(presetBranch).toMatch(/args\.palette_id !== undefined \|\| args\.moodboard_id !== undefined/)
  })
})

describe("one reader per table", () => {
  it("only the CRUD routes and the resolver read color_palettes / moodboards", () => {
    const readers = walk(SRC)
      .filter((f) => /\.from\(\s*["'](color_palettes|moodboards)["']/.test(readFileSync(f, "utf8")) || /ownedRow<[^>]+>\(\s*["'](color_palettes|moodboards)["']/.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f).replace(/\\/g, "/"))
      .sort()
    expect(readers).toEqual(["lib/user-direction.ts", "routes/moodboards.ts", "routes/palettes.ts"])
  })
})
