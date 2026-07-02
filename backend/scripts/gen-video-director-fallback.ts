/**
 * Regenerates the embedded FALLBACK_VIDEO_DIRECTOR_SKILL constant in
 * src/lib/mcp/tools/video-director.ts from the canonical skill sources
 * (backend/skills/video-director/{doctrine,explainer,product-launch}.md),
 * mirroring composeSkill()'s exact runtime composition.
 *
 * Run after ANY edit to those markdown files:
 *   cd backend && npm run gen:vd-fallback
 *
 * The drift guard (src/lib/mcp/tools/__tests__/video-director.test.ts:
 * "embedded fallback matches the composed skill") fails CI when this is
 * forgotten — this script is the sanctioned way to make it pass. Before it
 * existed the constant was hand-recomposed three phases in a row (Phase 2,
 * 2.x, 2.y), each time re-deriving the backtick-escaping by hand.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const tsPath = resolve(here, "../src/lib/mcp/tools/video-director.ts")
const skillsDir = resolve(here, "../skills/video-director")

/**
 * Finds the template literal that starts right after `decl` and returns the
 * span of its contents. Scans for the closing backtick, skipping escaped ones
 * (an even number of preceding backslashes means the backtick is real).
 */
function templateLiteralSpan(src: string, decl: string): { open: number; close: number } {
  const declIdx = src.indexOf(decl)
  if (declIdx === -1) throw new Error(`declaration not found: ${decl}`)
  const open = src.indexOf("`", declIdx)
  let i = open + 1
  for (;;) {
    const j = src.indexOf("`", i)
    if (j === -1) throw new Error("unterminated template literal")
    let backslashes = 0
    for (let k = j - 1; src[k] === "\\"; k--) backslashes++
    if (backslashes % 2 === 0) return { open, close: j }
    i = j + 1
  }
}

function unescapeTemplate(raw: string): string {
  return raw.replace(/\\\$\{/g, "${").replace(/\\`/g, "`").replace(/\\\\/g, "\\")
}

function escapeTemplate(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")
}

const src = readFileSync(tsPath, "utf-8")

// Mirror composeSkill(): header + "\n\n" + [doctrine, explainer, product-launch].join("\n\n---\n\n")
const headerSpan = templateLiteralSpan(src, "const VIDEO_DIRECTOR_HEADER = ")
const header = unescapeTemplate(src.slice(headerSpan.open + 1, headerSpan.close))
const body = ["doctrine.md", "explainer.md", "product-launch.md"]
  .map((f) => readFileSync(resolve(skillsDir, f), "utf-8").trimEnd())
  .join("\n\n---\n\n")
const composed = header + "\n\n" + body

const fallbackSpan = templateLiteralSpan(src, "export const FALLBACK_VIDEO_DIRECTOR_SKILL = ")
const next = src.slice(0, fallbackSpan.open + 1) + escapeTemplate(composed) + src.slice(fallbackSpan.close)

if (next === src) {
  console.log("FALLBACK_VIDEO_DIRECTOR_SKILL already up to date.")
} else {
  writeFileSync(tsPath, next)
  console.log(`FALLBACK_VIDEO_DIRECTOR_SKILL regenerated (${composed.length} chars composed).`)
}
