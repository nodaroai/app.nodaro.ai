/**
 * gen-skills — rewrite AUTO-GEN blocks inside backend/skills/ from the
 * canonical frontend NODE_DEFINITIONS literal + *Data interfaces +
 * MCP tool registry.
 *
 *   npm run gen:skills           # rewrite files in-place
 *   npm run gen:skills:check     # rewrite + `git diff --exit-code` (CI mode)
 *
 * Wire-up:
 *   1. parseNodeDefinitions() walks frontend/src/types/nodes.ts via ts-morph
 *      and returns one NodeDef per NODE_DEFINITIONS entry.
 *   2. parseDataInterface() looks up each entry's *Data interface/type for
 *      the field list rendered into the node-data-shape block.
 *   3. captureMcpToolSchemas() spins up an in-memory MCP server and
 *      intercepts registerTool() so we know every tool's input schema.
 *   4. render-skill.ts produces the body of each auto-gen block.
 *   5. marker-blocks.ts surgically rewrites blocks while preserving any
 *      prose between them.
 *
 * Phase A files (the 8-node whitelist) already exist with hand-written
 * prose between markers — gen-skills MUST keep that prose intact. The
 * `When to use` / `Common gotchas` sections sit between the auto-gen
 * blocks; marker-blocks.ts only touches text inside the START/END pairs.
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { captureMcpToolSchemas, type CapturedSchema } from "./lib/gen-skills/capture-mcp-schemas.js"
import { rewriteBlock } from "./lib/gen-skills/marker-blocks.js"
import {
  parseDataInterface,
  parseNodeDefinitions,
  type NodeDef,
} from "./lib/gen-skills/parse-node-definitions.js"
import {
  renderExampleBlock,
  renderMcpCallBlock,
  renderNodeDataShapeBlock,
  renderWorkflowEditorCatalog,
} from "./lib/gen-skills/render-skill.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, "..", "..")
const FRONTEND_NODES = join(REPO_ROOT, "frontend", "src", "types", "nodes.ts")
const SKILLS_DIR = join(REPO_ROOT, "backend", "skills")
const NODES_DIR = join(SKILLS_DIR, "nodes")
const WORKFLOW_EDITOR_FILE = join(SKILLS_DIR, "workflow-editor.md")

const CHECK_MODE = process.argv.includes("--check")

/**
 * Best-effort node-type → MCP tool name map. Unmapped node types omit the
 * mcp-call block (renderMcpCallBlock returns "" when the schema is
 * undefined). Extend as new 1:1 mappings appear.
 */
const NODE_TYPE_TO_TOOL: Record<string, string> = {
  "generate-image": "generate_image",
  "image-to-image": "image_to_image",
  "image-to-video": "animate_image",
  "text-to-video": "generate_video",
  "generate-video": "generate_video",
  "generate-music": "generate_music",
  "text-to-speech": "generate_speech",
  "text-to-audio": "text_to_audio",
  "trim-video": "trim_video",
  "combine-videos": "combine_videos",
  "merge-video-audio": "merge_video_audio",
  "lip-sync": "lip_sync",
  "voice-clone": "voice_clone",
  "voice-design": "voice_design",
  "voice-changer": "voice_changer",
  "voice-remix": "voice_remix",
  "edit-image": "edit_image",
  "modify-image": "modify_image",
  "modify-video": "modify_video",
  "video-to-video": "modify_video",
  "extract-frame": "extract_frame",
  "video-upscale": "video_upscale",
  "extend-video": "extend_video",
  "loop-video": "loop_video",
  "motion-transfer": "motion_transfer",
  "face-swap": "face_swap",
  "speech-to-video": "speech_to_video",
  "generate-character": "generate_character",
  "generate-location": "generate_location",
  "generate-object": "generate_object",
  "generate-mask": "generate_mask",
  "generate-script": "generate_script",
  "transcribe": "transcribe",
  "dubbing": "dubbing",
  "audio-isolation": "audio_isolation",
  "trim-audio": "trim_audio",
  "add-captions": "add_captions",
  "image-to-text": "image_to_text",
  "suno-generate": "suno_generate",
  "suno-extend": "suno_extend",
  "suno-cover": "suno_cover",
  "suno-mashup": "suno_mashup",
  "suno-lyrics": "suno_lyrics",
  "suno-add-vocals": "suno_add_vocals",
  "suno-add-instrumental": "suno_add_instrumental",
  "suno-replace-section": "suno_replace_section",
  "suno-style-boost": "suno_style_boost",
  "suno-music-video": "suno_music_video",
  "suno-convert-wav": "suno_convert_wav",
  "suno-upload-extend": "suno_upload_extend",
  "suno-separate": "suno_separate_stems",
}

/**
 * Heuristic mapper from kebab-case node type to PascalCase *Data interface
 * name. text-prompt → TextPromptData, image-to-video → ImageToVideoData,
 * 3d-title → 3dTitleData. parseDataInterface returns undefined when no
 * matching interface/type alias exists; render-skill.ts handles that gracefully.
 */
function nodeTypeToInterfaceName(type: string, suffix = "Data"): string {
  const pascal = type
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("")
  return `${pascal}${suffix}`
}

function gitShortSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf-8",
      cwd: REPO_ROOT,
    }).trim()
  } catch {
    return "unknown"
  }
}

/**
 * Compare a candidate body (without its frontmatter) against an existing
 * file's body. If they match, returning `null` lets the caller skip the
 * write so `generated_at` doesn't churn the file on every gen-skills run.
 * Without this, --check mode would ALWAYS see drift because each run
 * stamps a fresh ISO timestamp.
 */
function stripFrontmatter(source: string): string {
  const fmMatch = source.match(/^---\n[\s\S]*?\n---\n?/)
  if (fmMatch) return source.slice(fmMatch[0].length)
  return source
}

function ensureFrontmatter(source: string, type: string | null, sha: string): string {
  const now = new Date().toISOString()
  const lines = ["---"]
  if (type) lines.push(`node_type: ${type}`)
  lines.push(`generated_at: ${now}`)
  lines.push(`generated_from: ${sha}`)
  lines.push("---")
  const fm = lines.join("\n")
  const fmMatch = source.match(/^---\n[\s\S]*?\n---\n?/)
  if (fmMatch) return fm + "\n" + source.slice(fmMatch[0].length)
  return fm + "\n\n" + source
}

/**
 * Returns the source with a refreshed frontmatter ONLY when the body
 * (everything after the frontmatter block) actually changed. The git SHA
 * recorded in `generated_from` is updated alongside content changes; it
 * does NOT trigger a rewrite on its own. Without this guard, every commit
 * would invalidate every skill file on the next run (because HEAD's short
 * SHA moved), making --check mode fire spurious drift.
 */
function refreshFrontmatterIfChanged(
  candidate: string,
  existing: string | null,
  type: string | null,
  sha: string,
): string {
  if (existing === null) return ensureFrontmatter(candidate, type, sha)
  const candidateBody = stripFrontmatter(candidate)
  const existingBody = stripFrontmatter(existing)
  if (candidateBody === existingBody) {
    return existing
  }
  return ensureFrontmatter(candidate, type, sha)
}

function defaultNodeFileTemplate(_type: string, label: string): string {
  return `# ${label}

<!-- AUTO-GEN:START node-data-shape -->
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
<!-- AUTO-GEN:END examples -->
`
}

async function main(): Promise<void> {
  const sha = gitShortSha()

  console.log(`[gen-skills] parsing NODE_DEFINITIONS from ${FRONTEND_NODES}`)
  const defs: NodeDef[] = parseNodeDefinitions(FRONTEND_NODES)
  console.log(`[gen-skills] found ${defs.length} node definitions`)

  console.log("[gen-skills] capturing MCP tool schemas …")
  const captured: CapturedSchema[] = await captureMcpToolSchemas()
  const schemaByName = new Map<string, CapturedSchema>()
  for (const s of captured) schemaByName.set(s.name, s)
  console.log(`[gen-skills] captured ${captured.length} MCP tools`)

  // workflow-editor.md catalog block.
  console.log("[gen-skills] rewriting workflow-editor.md node-catalog block")
  const editorSource = readFileSync(WORKFLOW_EDITOR_FILE, "utf-8")
  const catalogBody = renderWorkflowEditorCatalog(defs)
  const editorRewritten = rewriteBlock(editorSource, "node-catalog", catalogBody)
  const editorFinal = refreshFrontmatterIfChanged(editorRewritten, editorSource, null, sha)
  if (editorFinal !== editorSource) {
    writeFileSync(WORKFLOW_EDITOR_FILE, editorFinal)
  }

  if (!existsSync(NODES_DIR)) mkdirSync(NODES_DIR, { recursive: true })

  // Per-node files.
  for (const def of defs) {
    const filePath = join(NODES_DIR, `${def.type}.md`)
    let source: string
    let existing: string | null = null
    let created = false
    if (existsSync(filePath)) {
      source = readFileSync(filePath, "utf-8")
      existing = source
    } else {
      source = defaultNodeFileTemplate(def.type, def.label)
      created = true
    }

    // Node data interfaces use either `<Pascal>Data` or `<Pascal>NodeData`
    // (e.g. WebScrapeNodeData, GenerateVideoNodeData, ListNodeData). Try the
    // bare suffix first, then fall back to `NodeData` so the data-shape block
    // isn't silently empty for the `*NodeData` variants.
    const shape =
      parseDataInterface(FRONTEND_NODES, nodeTypeToInterfaceName(def.type)) ??
      parseDataInterface(FRONTEND_NODES, nodeTypeToInterfaceName(def.type, "NodeData"))

    const shapeBody = renderNodeDataShapeBlock(def, shape)
    source = rewriteBlock(source, "node-data-shape", shapeBody)

    const toolName = NODE_TYPE_TO_TOOL[def.type]
    const schema = toolName ? schemaByName.get(toolName) : undefined
    const mcpBody = toolName ? renderMcpCallBlock(toolName, schema) : ""
    // Only rewrite the mcp-call block if we have meaningful content;
    // otherwise leave whatever the user wrote between the markers alone.
    if (mcpBody) {
      source = rewriteBlock(source, "mcp-call", mcpBody)
    }

    const examplesBody = renderExampleBlock(def)
    source = rewriteBlock(source, "examples", examplesBody)

    const final = refreshFrontmatterIfChanged(source, existing, def.type, sha)
    if (existing === null || final !== existing) {
      writeFileSync(filePath, final)
    }
    if (created) console.log(`[gen-skills]   created nodes/${def.type}.md`)
  }

  console.log("[gen-skills] done")

  if (CHECK_MODE) {
    try {
      execFileSync("git", ["diff", "--exit-code", "backend/skills/"], {
        stdio: "inherit",
        cwd: REPO_ROOT,
      })
      console.log("[gen-skills] no drift — backend/skills/ is up to date")
    } catch {
      console.error(
        "\n[gen-skills] DRIFT DETECTED — run `npm run gen:skills` from backend/ and commit the changes",
      )
      process.exit(1)
    }
  }
}

main().catch((err) => {
  console.error("[gen-skills] failed:", err)
  process.exit(1)
})
