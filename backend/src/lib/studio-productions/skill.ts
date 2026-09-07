import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  buildFormatRegistry,
  renderSkill,
  renderStrictJsonSchema,
} from "@nodaro/studio-production"
import type { StudioSkillResponse } from "@nodaro/shared"

/**
 * The studio production skill, in four parts.
 *
 * Three of them are RENDERED, not written: the authoring guide, the catalog and
 * the JSON Schema all come out of the same format registry the importer
 * validates against, so a picker added to the catalog reaches the skill with no
 * edit anywhere. That is the point of serving them from a route — the studio
 * app renders the identical bytes into its own `public/skills/`, and the two
 * cannot drift because there is one renderer.
 *
 * The fourth, the operating guide, is hand-written markdown: how to go from a
 * request to a film with these tools, and what these tools will not do. A
 * renderer cannot know that.
 *
 * Cached per process. The render walks the whole catalog and produces ~340 KB;
 * it is a pure function of two package versions, so the only thing that can
 * change it is a deploy.
 */

/** The installed versions the render is stamped with — read from the manifests. */
function generatedFrom(): { prompts: string; shared: string } {
  return {
    prompts: installedVersion("@nodaro/prompts"),
    shared: installedVersion("@nodaro/shared"),
  }
}

function installedVersion(pkg: string): string {
  // Neither package exports `./package.json`, so `require.resolve` would throw:
  // walk up from this module to the workspace root and read the manifest by
  // path, exactly as the studio app's own generator does.
  const here = dirname(fileURLToPath(import.meta.url))
  for (const up of ["../../../..", "../../../../..", "../../../../../.."]) {
    const path = resolve(here, up, "node_modules", pkg, "package.json")
    if (!existsSync(path)) continue
    const manifest = JSON.parse(readFileSync(path, "utf8")) as { version?: unknown }
    if (typeof manifest.version === "string") return manifest.version
  }
  return "unknown"
}

/** `backend/skills/`, whether running from `src/` (tsx) or `dist/` (built). */
function skillsDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..", "skills")
}

const OPERATING_FALLBACK =
  "# Operating a Nodaro Studio production\n\n" +
  "The operating guide was not readable on this deployment. Call " +
  "`get_studio_production_skill` with `part: \"authoring\"` for the plan format, " +
  "validate every plan with `validate_studio_plan` before importing it, and " +
  "address a result by its `key`, never by its position.\n"

function operatingSkill(): string {
  try {
    return readFileSync(resolve(skillsDir(), "studio-production.md"), "utf-8")
  } catch {
    return OPERATING_FALLBACK
  }
}

let cached: StudioSkillResponse | undefined

/** The four parts, rendered once per process. */
export function studioProductionSkill(): StudioSkillResponse {
  if (cached) return cached
  const registry = buildFormatRegistry()
  const from = generatedFrom()
  const { skillMd, catalogMd } = renderSkill(registry, from)
  cached = {
    skill: skillMd,
    catalog: catalogMd,
    schema: renderStrictJsonSchema(registry) as Record<string, unknown>,
    operating: operatingSkill(),
    generatedFrom: from,
  }
  return cached
}

/** Drop the cache — tests only. */
export function _resetStudioSkillCacheForTests(): void {
  cached = undefined
}
