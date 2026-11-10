// @test-always scans every frontend source for the places that make a node from its default data, besides the config panels' model menus
/**
 * TOTALITY for "a new node starts on a model the deployment offers"
 * (`components/editor/config-panels/new-node-models.ts`, decided 2026-11-10). This holds:
 *
 *  1. Every model a node type's default data carries (a catalog id, an LLM id,
 *     or a value of a model menu's registry) is a field the rule moves, or is
 *     listed below with the reason it is not.
 *  2. Every model menu a config panel renders (`useOfferedModels`,
 *     `withoutDeniedModels`, `LlmModelSelect`, an `isModelUnavailable` filter)
 *     is the menu of a lever, with the very registry or LLM feature (and
 *     filter) the lever offers from — or is listed with its reason.
 *  3. Every node type whose panel renders a lever's menu is that lever's type
 *     (a new node type that reuses a panel with a model menu needs a decision).
 *  4. Every place that makes a node from its default data goes through the rule
 *     (`newNodeDefaultData`, or `withOfferedNewNodeModels` on the definition's
 *     defaults) and notes what it made (`noteNewNodesFromDefaults`); every other
 *     reader of `defaultData` is listed with what it reads it for.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import * as MODEL_OPTIONS from "@/components/editor/config-panels/model-options"
import { NEW_NODE_MODEL_LEVERS } from "@/components/editor/config-panels/new-node-models"
import { NODE_DEFINITIONS } from "@/types/nodes"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { LLM_MODELS } from "@nodaro/shared/llm-models"
import { VOICE_CHANGER_MODELS } from "@nodaro/shared/models"
import { VIDEO_MASK_PROVIDERS } from "@nodaro/shared/media"

const SRC = join(__dirname, "..", "..", "..", "..")
const PANELS = join(SRC, "components/editor/config-panels")
const UNITS = join(SRC, "nodes")

// ── Why a model in a node's defaults, or a model menu, is not moved ─────────

/** A menu that lists its models by hand and hides none, so a default always counts as offered. */
const UNFILTERED = "its menu lists its models by hand and hides none a deployment withholds, so the default counts as offered; the node is still refused at run where its model is withheld"
/** A menu whose values are not the ids a restriction names, so it hides nothing. */
const RAW_VALUES = "its menu's values are not the model ids a restriction names (the run maps them), so the menu hides nothing a restriction withholds and the default counts as offered; the node is still refused at run where its model is withheld"
/** No model menu at all. */
const NO_MENU = "its panel has no model menu, so there is nothing to start it on; the node is still refused at run where its model is withheld"

/** `<type>.<field>` → why a model that field holds in the defaults is not moved. */
const EXEMPT_FIELDS: Readonly<Record<string, string>> = {
  "generate-video-pro.plannerModel": `the planner model: ${UNFILTERED}`,
  "reference-board.provider": UNFILTERED,
  "generate-music.provider": `${RAW_VALUES} (\`minimax\` is the MiniMax music engine, not the catalog's MiniMax video model)`,
  "text-to-audio.provider": UNFILTERED,
  "transcribe.provider": UNFILTERED,
  "suno-generate.model": `${RAW_VALUES} (Suno's \`V6\` is the catalog's \`suno-v6\`)`,
  "suno-cover.model": RAW_VALUES,
  "suno-extend.model": RAW_VALUES,
  "suno-mashup.model": RAW_VALUES,
  "suno-add-instrumental.model": RAW_VALUES,
  "suno-add-vocals.model": RAW_VALUES,
  "suno-upload-extend.model": RAW_VALUES,
  "voice-changer.model": `${RAW_VALUES} (ElevenLabs speech-to-speech ids)`,
  "voice-changer-pro.model": `${RAW_VALUES} (ElevenLabs speech-to-speech ids)`,
  "video-retake.provider": `${NO_MENU} (its one model is fixed)`,
  "scene.image_model": `its model fields are free-text inputs, not a menu: ${NO_MENU}`,
  "scene.video_model": `its model fields are free-text inputs, not a menu: ${NO_MENU}`,
}

/** `<file in config-panels>#<component>` → why that model menu is no lever's. */
const EXEMPT_MENUS: Readonly<Record<string, string>> = {
  "kling3-studio-config.tsx#Kling3StudioConfig":
    "renders in place of a video node's own panel only while the node is on Kling 3.0; a new node starts on its type's default, whose menu is that type's panel",
  "video-configs.tsx#MotionTransferConfigImpl": `${RAW_VALUES} (\`kling\` is judged as the Kling video model while the run is the catalog's \`motion-transfer\`)`,
  "audio-configs.tsx#SunoGenerateConfig": RAW_VALUES,
  "audio-configs.tsx#SunoCoverConfig": RAW_VALUES,
  "audio-configs.tsx#SunoExtendConfig": RAW_VALUES,
  "audio-configs.tsx#SunoMashupConfig": RAW_VALUES,
  "audio-configs.tsx#SunoAddInstrumentalConfig": RAW_VALUES,
  "audio-configs.tsx#SunoAddVocalsConfig": RAW_VALUES,
  "audio-configs.tsx#SunoUploadExtendConfig": RAW_VALUES,
  "audio-configs.tsx#VoiceChangerConfig": RAW_VALUES,
  "audio-configs.tsx#VoiceChangerProConfig": RAW_VALUES,
  "prompt-helper-dialog.tsx#PromptHelperDialog": "the Prompt Helper's own model, picked in its dialog — not a field of the node",
}

/** Non-test sources that read a definition's `defaultData` for something other than making a node. */
const DEFAULT_DATA_READERS: Readonly<Record<string, string>> = {
  "lib/unit-compose.ts": "composes the units' definitions",
  "hooks/use-workflow-store.ts": "`newNodeDefaultData`, the funnel itself",
  "components/editor/workflow-canvas.tsx": "a node type's default label",
  "components/nodes/group-node.tsx": "the group's default label",
  "components/nodes/loop-node.tsx": "a comment",
  "lib/replace-render-node.ts": "the target type's default label and medium (the swap's data comes from `newNodeDefaultData`)",
  "lib/preset-tree.ts": "a preset's diff against the defaults",
  "components/editor/config-panels/node-preset-dropdown.tsx":
    "Reset to default on an EXISTING node — not a new node, so it is left as it was (not decided here)",
  "components/presentation/exposable-fields.ts": "which fields an app may expose",
  "components/editor/workflow-editor/clear-run-results.ts": "what Clear results resets a node's run fields to",
  "lib/generate-video-audio-migration.ts": "a load-time migration of a SAVED graph (its Merge node runs no model)",
}

// ── Reading the sources ──────────────────────────────────────────────────────

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

/** A source split into its top-level declarations: name → text. */
function topLevelBlocks(text: string): Map<string, string> {
  const blocks = new Map<string, string>()
  let name: string | null = null
  let lines: string[] = []
  const flush = () => {
    if (name) blocks.set(name, (blocks.get(name) ?? "") + lines.join("\n"))
  }
  for (const line of text.split("\n")) {
    const m = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)|^(?:export\s+)?const\s+(\w+)\s*[:=]/.exec(line)
    if (m) {
      flush()
      name = m[1] ?? m[2]!
      lines = []
    }
    lines.push(line)
  }
  flush()
  return blocks
}

interface MenuSite {
  readonly site: string
  /** The registry it renders, or the LLM feature expression of an `LlmModelSelect`. */
  readonly registry?: string
  readonly llmFeature?: string
  readonly filter?: string
}

const REGISTRY_MENU = [
  /\buseOfferedModels\(\s*([A-Z0-9_]+)/g,
  /\bwithoutDeniedModels\(\s*([A-Z0-9_]+)/g,
  /\b([A-Z0-9_]+)\.filter\(\(\w+\)\s*=>\s*\w+\s*===\s*\w+\s*\|\|\s*!isModelUnavailable\(/g,
]

/** A feature written as a module constant (`feature={SCENE3D_LLM_FEATURE}`) read as the string it names. */
function resolveConstant(expr: string | undefined, text: string): string | undefined {
  if (expr === undefined || !/^[A-Z][A-Z0-9_]*$/.test(expr)) return expr
  const declared = new RegExp(`const\\s+${expr}\\s*=\\s*"([^"]+)"`).exec(text)
  return declared ? declared[1] : expr
}

/** Every model menu in a panel file: its `<file>#<component>` and what it renders. */
function menuSites(file: string, label: string): MenuSite[] {
  const sites: MenuSite[] = []
  const text = readFileSync(file, "utf8")
  for (const [fn, block] of topLevelBlocks(text)) {
    const site = `${label}#${fn}`
    for (const pattern of REGISTRY_MENU) {
      for (const m of block.matchAll(pattern)) sites.push({ site, registry: m[1]! })
    }
    for (const m of block.matchAll(/<LlmModelSelect\b([\s\S]*?)\/>/g)) {
      const props = m[1]!
      const feature = /feature=(?:"([^"]+)"|\{([^}]+)\})/.exec(props)
      const filter = /filter=\{([\s\S]*?)\}\s*(?:\w+=|$)/.exec(props)
      sites.push({
        site,
        llmFeature: feature?.[1] ?? resolveConstant(feature?.[2]?.trim(), text),
        ...(filter ? { filter: filter[1]!.trim() } : {}),
      })
    }
  }
  return sites
}

const panelFiles = readdirSync(PANELS).filter((f) => f.endsWith(".tsx")).map((f) => ({ path: join(PANELS, f), label: f }))
const unitPanels = readdirSync(UNITS)
  .filter((d) => statSync(join(UNITS, d)).isDirectory() && !d.startsWith("_"))
  .flatMap((d) => {
    const path = join(UNITS, d, "config.tsx")
    try {
      statSync(path)
      return [{ path, label: `nodes/${d}/config.tsx` }]
    } catch {
      return []
    }
  })
const SITES: readonly MenuSite[] = [...panelFiles, ...unitPanels].flatMap(({ path, label }) => menuSites(path, label))

/** Which node types each config component is rendered for: config-panel.tsx's switch, and every unit's own panel. */
function panelOfType(): Map<string, string> {
  const map = new Map<string, string>()
  const text = readFileSync(join(SRC, "components/editor/config-panel.tsx"), "utf8")
  let pending: string[] = []
  for (const line of text.split("\n")) {
    for (const m of line.matchAll(/case\s+"([^"]+)":/g)) pending.push(m[1]!)
    if (pending.length === 0) continue
    const component = /<([A-Z]\w*)/.exec(line.replace(/case\s+"[^"]+":/g, ""))
    if (component) {
      for (const type of pending) map.set(type, component[1]!)
      pending = []
    } else if (/\breturn\b[^(]*$/.test(line) && !/return\s*\($/.test(line.trim())) {
      pending = []
    }
  }
  for (const unit of unitPanels) map.set(unit.label.split("/")[1]!, unit.label)
  return map
}

/** The components that render `fn` (itself, and up through every panel component that renders it). */
function hostsOf(fn: string, blocksByFile: ReadonlyMap<string, Map<string, string>>): Set<string> {
  const hosts = new Set<string>([fn])
  let grew = true
  while (grew) {
    grew = false
    for (const blocks of blocksByFile.values()) {
      for (const [name, text] of blocks) {
        if (hosts.has(name)) continue
        if ([...hosts].some((h) => new RegExp(`<${h}[\\s/>]|memo\\(${h}\\)`).test(text))) {
          hosts.add(name)
          grew = true
        }
      }
    }
  }
  return hosts
}

const leverEntries = Object.entries(NEW_NODE_MODEL_LEVERS).flatMap(([type, levers]) => levers.map((lever) => ({ type, lever })))

describe("1. every model a node's defaults carry is moved, or says why not", () => {
  const registryValues = Object.entries(MODEL_OPTIONS)
    .filter(([name, v]) => /_(MODELS|PROVIDERS|MODEL_OPTIONS)$/.test(name) && Array.isArray(v))
    .flatMap(([, v]) => (v as unknown[]).map((r) => (typeof r === "string" ? r : (r as { value?: unknown } | null)?.value)))
    .filter((v): v is string => typeof v === "string")
  const MODEL_IDS = new Set<string>([
    ...Object.keys(MODEL_CATALOG),
    ...LLM_MODELS.map((m) => m.id),
    ...VOICE_CHANGER_MODELS.map((m) => m.value),
    ...VIDEO_MASK_PROVIDERS,
    ...registryValues,
  ])

  /** `<type>.<field>` for every default value that is a model, one level of object fields deep. */
  const modelFields = NODE_DEFINITIONS.flatMap((def) => {
    const data = (def.defaultData ?? {}) as Record<string, unknown>
    return Object.entries(data).flatMap(([key, value]) => {
      if (typeof value === "string" && MODEL_IDS.has(value)) return [`${def.type}.${key}`]
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return Object.entries(value as Record<string, unknown>)
          .filter(([, v]) => typeof v === "string" && MODEL_IDS.has(v))
          .map(([k]) => `${def.type}.${key}.${k}`)
      }
      return []
    })
  })
  const leverFields = new Set(leverEntries.map(({ type, lever }) => `${type}.${lever.field}`))

  it("found the models (the catalog, the LLMs and the menus' registries are read)", () => {
    expect(modelFields.length).toBeGreaterThan(20)
    expect(modelFields).toEqual(expect.arrayContaining(["modify-image.provider", "text-to-speech.provider", "generate-image.provider"]))
  })

  it("each is a lever's field or is exempt with a reason", () => {
    expect(modelFields.filter((f) => !leverFields.has(f) && !EXEMPT_FIELDS[f])).toEqual([])
  })

  it("no exemption is stale: each names a model the defaults carry that no lever moves", () => {
    const fields = new Set(modelFields)
    expect(Object.keys(EXEMPT_FIELDS).filter((f) => EXEMPT_FIELDS[f] && (!fields.has(f) || leverFields.has(f)))).toEqual([])
  })
})

describe("2. every model menu a panel renders is a lever's, with its registry, or says why not", () => {
  it("found the menus (the panels are read)", () => {
    expect(SITES.length).toBeGreaterThan(30)
    expect(SITES.map((s) => s.site)).toEqual(expect.arrayContaining(["image-configs.tsx#ModifyImageConfigImpl", "script-configs.tsx#ImageToTextConfig"]))
  })

  it("each is claimed by a lever naming the same registry or LLM feature and filter, or is exempt", () => {
    const unclaimed = SITES.filter((s) => {
      if (EXEMPT_MENUS[s.site]) return false
      return !leverEntries.some(({ lever }) => {
        const menu = lever.menu
        if (menu.site !== s.site) return false
        if ("registry" in menu) return s.registry === menu.registry
        if (s.llmFeature !== menu.llmFeature) return false
        return s.filter === menu.filter
      })
    })
    expect(unclaimed.map((s) => `${s.site} → ${s.registry ?? `LlmModelSelect feature=${s.llmFeature}${s.filter ? ` filter=${s.filter}` : ""}`}`)).toEqual([])
  })

  it("each lever's menu is one a panel renders (no lever names a menu that is not there)", () => {
    const missing = leverEntries.filter(({ lever }) => {
      const menu = lever.menu
      return !SITES.some((s) => s.site === menu.site && ("registry" in menu ? s.registry === menu.registry : s.llmFeature === menu.llmFeature))
    })
    expect(missing.map(({ type, lever }) => `${type}: ${lever.menu.site}`)).toEqual([])
  })

  it("no exempt menu is stale", () => {
    const found = new Set(SITES.map((s) => s.site))
    expect(Object.keys(EXEMPT_MENUS).filter((site) => !found.has(site))).toEqual([])
  })
})

describe("3. every node type whose panel renders a lever's menu is that lever's type", () => {
  const blocksByFile = new Map([...panelFiles, ...unitPanels].map(({ path, label }) => [label, topLevelBlocks(readFileSync(path, "utf8"))]))
  const panels = panelOfType()

  it("read the panels of the node types", () => {
    expect(panels.get("modify-image")).toBe("ModifyImageConfig")
    expect(panels.size).toBeGreaterThan(150)
  })

  it("each node type rendering a claimed menu is covered by a lever there, or names its reason", () => {
    const wrong: string[] = []
    for (const site of SITES) {
      if (EXEMPT_MENUS[site.site]) continue
      const fn = site.site.split("#")[1]!
      const hosts = hostsOf(fn, blocksByFile)
      for (const [type, component] of panels) {
        if (!hosts.has(component) && !hosts.has(`${component}Impl`)) continue
        const covered = (NEW_NODE_MODEL_LEVERS[type] ?? []).some((lever) => lever.menu.site === site.site)
        if (!covered) wrong.push(`${type} renders ${site.site} (${site.registry ?? site.llmFeature}) but no lever of ${type} names it`)
      }
    }
    expect(wrong).toEqual([])
  })

  it("each lever sits on its own type's panel", () => {
    const wrong = leverEntries.filter(({ type, lever }) => {
      const component = panels.get(type)
      if (!component) return true
      const hosts = hostsOf(lever.menu.site.split("#")[1]!, blocksByFile)
      return !hosts.has(component) && !hosts.has(`${component}Impl`)
    })
    expect(wrong.map(({ type, lever }) => `${type} (panel ${panels.get(type)}) → ${lever.menu.site}`)).toEqual([])
  })
})

describe("4. every place that makes a node from its default data goes through the rule", () => {
  const files = sourceFiles(SRC).map((path) => ({ rel: relative(SRC, path), text: readFileSync(path, "utf8") }))

  it("every caller of newNodeDefaultData also notes the nodes it makes", () => {
    const callers = files.filter((f) => f.rel !== "hooks/use-workflow-store.ts" && /\bnewNodeDefaultData\(/.test(f.text))
    expect(callers.length).toBeGreaterThan(3)
    expect(callers.filter((f) => !/\bnoteNewNodesFromDefaults\(/.test(f.text)).map((f) => f.rel)).toEqual([])
  })

  it("the store's addNode notes the nodes it makes", () => {
    const store = files.find((f) => f.rel === "hooks/use-workflow-store.ts")!.text
    const addNode = store.slice(store.indexOf("  addNode: (type, position, initialData) => {"), store.indexOf("  openPickerForNode:"))
    expect(addNode).toMatch(/newNodeDefaultData\(type\)/)
    expect(addNode).toMatch(/noteNewNodesFromDefaults\(/)
  })

  it("every other reader of a definition's defaultData puts them on offered models and notes them, or reads them for something else", () => {
    const readers = files.filter((f) => /\.defaultData\b/.test(f.text))
    const unexplained = readers
      .filter((f) => !DEFAULT_DATA_READERS[f.rel])
      .filter((f) => !(/\bwithOfferedNewNodeModels\(/.test(f.text) && /\bnoteNewNodesFromDefaults\(/.test(f.text)))
    expect(unexplained.map((f) => f.rel)).toEqual([])
  })

  it("no listed reader is stale", () => {
    const readers = new Set(files.filter((f) => /\.defaultData\b/.test(f.text)).map((f) => f.rel))
    expect(Object.keys(DEFAULT_DATA_READERS).filter((rel) => !readers.has(rel))).toEqual([])
  })
})
