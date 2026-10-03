/**
 * Generate Script's settings inputs. The Tone, Style Guide, Scene Count and
 * Duration nodes used to connect to nothing on Generate Script (only Tone, into
 * Prompt, where it did nothing). Each now has its own pip, and the canvas drop,
 * the handle registry and the add-node popup all read one rule.
 *
 * Also pins that every Generation Settings node DECLARES the output id it
 * RENDERS: `count` / `style` / `ratio` were declared `scene_count` /
 * `style_guide` / `aspect_ratio` from the day the nodes were added, so agents
 * reading the declared ids wrote edges the canvas never drew.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { isValidGenerateScriptConnection, GENERATE_SCRIPT_FIELD_HANDLES } from "../audio-text-handles"
import { TARGET_HANDLE_ACCEPTS } from "../target-handle-registry"
import { getCompatibleNodes } from "../node-compatibility"
import { getNodeOptions } from "../node-options"
import { NODE_DEF_MAP } from "@/types/nodes"

const noPicker = () => false
const accepts = (handle: string, source: string) => isValidGenerateScriptConnection(handle, source, noPicker)

describe("Generate Script settings inputs — connection rule", () => {
  it.each([
    [GENERATE_SCRIPT_FIELD_HANDLES.tone, "tone", true],
    [GENERATE_SCRIPT_FIELD_HANDLES.tone, "text-prompt", true],
    [GENERATE_SCRIPT_FIELD_HANDLES.styleGuide, "style-guide", true],
    [GENERATE_SCRIPT_FIELD_HANDLES.styleGuide, "llm-chat", true],
    [GENERATE_SCRIPT_FIELD_HANDLES.sceneCount, "scene-count", true],
    [GENERATE_SCRIPT_FIELD_HANDLES.targetLength, "duration", true],
    // A number setting takes only its own node.
    [GENERATE_SCRIPT_FIELD_HANDLES.sceneCount, "text-prompt", false],
    [GENERATE_SCRIPT_FIELD_HANDLES.sceneCount, "duration", false],
    [GENERATE_SCRIPT_FIELD_HANDLES.targetLength, "scene-count", false],
    // Media never feeds a setting.
    [GENERATE_SCRIPT_FIELD_HANDLES.tone, "upload-image", false],
    [GENERATE_SCRIPT_FIELD_HANDLES.styleGuide, "upload-video", false],
  ])("%s accepts %s: %s", (handle, source, expected) => {
    expect(accepts(handle, source)).toBe(expected)
  })

  it("the node declares every settings input it renders", () => {
    const inputs = NODE_DEF_MAP.get("generate-script")?.inputs ?? []
    for (const handle of Object.values(GENERATE_SCRIPT_FIELD_HANDLES)) expect(inputs).toContain(handle)
  })

  it("the handle registry carries the same rule, so hover glow and one-click connect agree", () => {
    const entries = TARGET_HANDLE_ACCEPTS["generate-script"] ?? []
    for (const handle of Object.values(GENERATE_SCRIPT_FIELD_HANDLES)) {
      const entry = entries.find((e) => e.handleId === handle)
      expect(entry, handle).toBeDefined()
      expect(entry!.accepts("scene-count")).toBe(accepts(handle, "scene-count"))
      expect(entry!.accepts("text-prompt")).toBe(accepts(handle, "text-prompt"))
    }
  })

  it("dragging from a settings input offers its Generation Settings node", () => {
    const offered = (handle: string) =>
      getCompatibleNodes(handle, "target", getNodeOptions(), "generate-script").direct.map((o) => o.type)
    expect(offered(GENERATE_SCRIPT_FIELD_HANDLES.sceneCount)).toEqual(["scene-count"])
    expect(offered(GENERATE_SCRIPT_FIELD_HANDLES.targetLength)).toEqual(["duration"])
    expect(offered(GENERATE_SCRIPT_FIELD_HANDLES.tone)).toContain("tone")
    expect(offered(GENERATE_SCRIPT_FIELD_HANDLES.styleGuide)).toContain("style-guide")
  })
})

describe("Generation Settings nodes declare the output id they render", () => {
  const nodesDir = join(__dirname, "..", "..", "components", "nodes")
  const index = readFileSync(join(nodesDir, "index.ts"), "utf8")
  const SETTINGS_TYPES = ["tone", "style-guide", "provider", "scene-count", "duration", "aspect-ratio", "motion"]

  it.each(SETTINGS_TYPES)("%s", (type) => {
    // "scene-count": SceneCountNode  →  import { SceneCountNode } from "./scene-count-node"
    const component = new RegExp(`(?:"${type}"|\\b${type}\\b):\\s*(\\w+)`).exec(index)?.[1]
    expect(component, `no component registered for ${type}`).toBeDefined()
    const file = new RegExp(`import \\{ ${component} \\} from "\\./([\\w-]+)"`).exec(index)?.[1]
    expect(file, `no import for ${component}`).toBeDefined()
    const source = readFileSync(join(nodesDir, `${file}.tsx`), "utf8")
    // Lazy across the props: `icon={<Hash />}` puts a ">" before handleId.
    const rendered = /<ParameterNodeShell\b[\s\S]*?\bhandleId="([^"]+)"/.exec(source)?.[1]
    expect(rendered, `no ParameterNodeShell handleId in ${file}.tsx`).toBeDefined()
    expect(NODE_DEF_MAP.get(type as never)?.outputs).toEqual([rendered])
  })
})
