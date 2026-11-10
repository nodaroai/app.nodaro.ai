// @test-always scans every frontend source for a menu that judges a model row by its raw value
/**
 * The editor's model menus judge a row as the model it makes the node RUN
 * (decided 2026-11-10) — the server's rule (`@nodaro/render-rules`
 * `provider-model.ts`), never the raw value: Generate Music's `minimax` is the
 * MiniMax music engine and no catalog model, so withholding the MiniMax VIDEO
 * model must not hide it; Motion Transfer's `kling` runs the catalog's
 * `motion-transfer`, so withholding THAT hides it, and withholding the Kling
 * video model does not.
 *
 * Every menu filter names its node (`withoutDeniedModels` / `useOfferedModels`
 * take the owner, a strip control is stamped with its node type), so a new
 * menu judges the same way by construction. The guard below fails a component
 * that asks `isModelUnavailable` about a row itself, outside the files listed
 * with the reason their rows are the model ids they run.
 */
import { describe, it, expect, afterEach } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { __resetSurfaceAvailabilityForTests } from "@/lib/surface-availability"
import { MOTION_TRANSFER_MODELS, isMenuRowWithheld, withoutDeniedModels } from "@/components/editor/config-panels/model-options"
import { getQuickConfigs, resolveQuickConfigOptions } from "@/components/nodes/node-quick-configs"

afterEach(() => __resetSurfaceAvailabilityForTests(null))

const withholding = (models: readonly string[]) => __resetSurfaceAvailabilityForTests({ nodes: [], models: [...models], modelsRestricted: true })

const stripValues = (type: string, field = "provider", data: Record<string, unknown> = {}) => {
  const control = getQuickConfigs(type).find((c) => c.field === field)
  if (!control) throw new Error(`${type} has no ${field} strip control`)
  return resolveQuickConfigOptions(control, data).map((o) => o.value)
}

describe("a menu row is judged as the model it makes the node run", () => {
  it("Generate Music's MiniMax engine stays when the MiniMax video model is withheld", () => {
    withholding(["minimax"])
    expect(stripValues("generate-music")).toContain("minimax")
    expect(isMenuRowWithheld({ nodeType: "generate-music" }, "minimax")).toBe(false)
    // The same id on a video node IS the withheld video model.
    expect(isMenuRowWithheld({ nodeType: "generate-video" }, "minimax")).toBe(true)
  })

  it("Motion Transfer's Kling rows follow the motion models they run, not the Kling video models", () => {
    const menu = { nodeType: "motion-transfer" }
    withholding(["kling", "kling-3.0"])
    expect(withoutDeniedModels(MOTION_TRANSFER_MODELS, menu).map((m) => m.value)).toEqual(MOTION_TRANSFER_MODELS.map((m) => m.value))
    withholding(["motion-transfer"])
    expect(withoutDeniedModels(MOTION_TRANSFER_MODELS, menu).map((m) => m.value)).not.toContain("kling")
    expect(withoutDeniedModels(MOTION_TRANSFER_MODELS, menu).map((m) => m.value)).toContain("kling-3.0")
    // The node's stored model stays listed, as every menu keeps it.
    expect(withoutDeniedModels(MOTION_TRANSFER_MODELS, menu, "kling").map((m) => m.value)).toContain("kling")
    // Its strip judges the same way.
    expect(stripValues("motion-transfer")).not.toContain("kling")
  })

  it("Video Upscale's Topaz row is the catalog's topaz-video", () => {
    withholding(["topaz"])
    expect(stripValues("video-upscale")).toContain("topaz")
    withholding(["topaz-video"])
    expect(stripValues("video-upscale")).not.toContain("topaz")
  })

  it("a row of any other field is its own model id (an LLM, a Suno or voice model)", () => {
    withholding(["claude-opus-5-5"])
    expect(isMenuRowWithheld({ nodeType: "qa-check", field: "llmModel" }, "claude-opus-5-5")).toBe(true)
    expect(isMenuRowWithheld({ nodeType: "qa-check", field: "llmModel" }, "gpt-5.6-terra")).toBe(false)
  })

  it("a deployment that withholds nothing hides nothing", () => {
    withholding([])
    expect(stripValues("generate-music")).toContain("minimax")
    expect(withoutDeniedModels(MOTION_TRANSFER_MODELS, { nodeType: "motion-transfer" })).toHaveLength(MOTION_TRANSFER_MODELS.length)
  })

  it("every strip control a node type's registry hands out carries that node type", () => {
    for (const type of ["generate-music", "motion-transfer", "video-upscale", "generate-image", "llm-chat"]) {
      for (const control of getQuickConfigs(type)) expect(control.nodeType, `${type}.${control.field}`).toBe(type)
    }
  })
})

// ── The guard ────────────────────────────────────────────────────────────────

const SRC = join(__dirname, "..", "..", "..", "..")

/** Non-test sources that ask `isModelUnavailable` about a menu row themselves, and why that is the row's model. */
const JUDGES_ROWS_ITSELF: Readonly<Record<string, string>> = {
  "lib/surface-availability.ts": "defines it",
  "components/editor/config-panels/model-options.ts": "`isMenuRowWithheld`, the judge every menu filter goes through",
  "components/editor/config-panels/llm-model-select.tsx": "an LLM menu: each row is an `LLM_MODELS` id, the model the node runs",
  "components/nodes/llm-chat-quick-toolbar.tsx": "an LLM menu: each row is an `LLM_MODELS` id, the model the node runs",
  "components/editor/config-panels/video-mask-config.tsx": "Video Mask's rows are `VIDEO_MASK_PROVIDERS`, catalog ids of the models a mask runs",
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (entry === "__tests__" || entry === "_generated" || entry === "node_modules" || entry === "test") continue
      sourceFiles(path, out)
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts")) {
      out.push(path)
    }
  }
  return out
}

describe("no menu judges a row by its raw value", () => {
  const callers = sourceFiles(SRC)
    .map((path) => ({ rel: relative(SRC, path).split("\\").join("/"), text: readFileSync(path, "utf8") }))
    .filter((f) => /\bisModelUnavailable\(/.test(f.text))
    .map((f) => f.rel)

  it("found the callers", () => {
    expect(callers).toEqual(expect.arrayContaining(["components/editor/config-panels/model-options.ts"]))
  })

  it("every source that asks isModelUnavailable about a row itself says why the row is the model it runs", () => {
    expect(callers.filter((rel) => !JUDGES_ROWS_ITSELF[rel])).toEqual([])
  })

  it("no listed file is stale", () => {
    expect(Object.keys(JUDGES_ROWS_ITSELF).filter((rel) => !callers.includes(rel))).toEqual([])
  })
})
