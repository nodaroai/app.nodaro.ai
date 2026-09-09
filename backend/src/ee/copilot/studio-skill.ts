/**
 * The two served slices the studio system prompt is composed from.
 *
 * The operation vocabulary and the plan-format rules have ONE home — the
 * skill `get_studio_production_skill` serves — and the copilot reads two named
 * sections out of it rather than keeping a second copy in this repo that would
 * drift the day the guide is edited. Two sections, not two whole parts: the
 * guide is twenty kilobytes of loop advice written for an outside client, most
 * of which the rail countermands.
 *
 * The read is memoised per process with a short life, so a turn does not pay
 * for it and a guide that changes under a redeploy is picked up without one. A
 * read that FAILED is never cached: a deployment whose studio service is not
 * up yet would otherwise be starved of the vocabulary for the whole window.
 */
import type { McpInvoker } from "../../lib/mcp/invoke.js"

/** How long a successful read of one part is reused. */
export const STUDIO_SKILL_TTL_MS = 10 * 60_000

/** The section of the operating guide that carries the edit vocabulary. */
export const VOCABULARY_HEADING = "Editing a production"
/** The section of the authoring guide that carries the plan format's rules. */
export const RULES_HEADING = "Rules"

export interface StudioSkillTails {
  /** The operations a batch may use, as the guide states them. */
  vocabulary: string | null
  /** The rules a plan must satisfy, as the guide states them. */
  rules: string | null
}

export interface SkillLog {
  warn(details: Record<string, unknown>, message: string): void
}

/**
 * One `## ` section of a markdown document, from its heading to the next one.
 *
 * Matched on the heading LINE, so a mention in prose or a deeper heading of
 * the same words is not a section — the slice has to be the section the guide
 * means, or the prompt would carry the wrong text with no way to tell.
 */
export function sliceSection(markdown: string, heading: string): string | null {
  const lines = markdown.split("\n")
  const start = lines.findIndex((line) => line.trimEnd() === `## ${heading}`)
  if (start === -1) return null
  const rest = lines.slice(start + 1)
  const next = rest.findIndex((line) => line.startsWith("## "))
  const body = next === -1 ? rest : rest.slice(0, next)
  return [lines[start], ...body].join("\n").trimEnd()
}

interface CachedPart {
  at: number
  text: string | null
}

const cache = new Map<string, CachedPart>()

/** Test hook, and the way a process picks up a redeployed guide in a test run. */
export function resetStudioSkillCache(): void {
  cache.clear()
}

function textOf(result: { content: { type: string; text?: string }[] }): string {
  return result.content
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .filter(Boolean)
    .join("\n")
}

async function slice(
  invoker: McpInvoker,
  part: "operating" | "authoring",
  heading: string,
  log: SkillLog | undefined,
  now: number,
): Promise<string | null> {
  const cached = cache.get(part)
  if (cached && now - cached.at < STUDIO_SKILL_TTL_MS) return cached.text

  const result = await invoker.callTool("get_studio_production_skill", { part })
  if (result.isError) {
    // Not cached: the studio service may simply not be serving yet.
    log?.warn({ part }, "[copilot] the studio skill could not be read; its section is omitted")
    return null
  }

  const text = sliceSection(textOf(result), heading)
  if (text === null) {
    log?.warn({ part, heading }, "[copilot] the studio skill no longer carries this section; it is omitted")
  }
  cache.set(part, { at: now, text })
  return text
}

/**
 * The vocabulary and the rules, ready to follow the doctrine in one system
 * block. A section the guide no longer carries is omitted with a warning — the
 * model's own tool descriptions already send it to the skill when it needs the
 * vocabulary, so an omission degrades a turn rather than breaking it.
 */
export async function studioSkillTails(invoker: McpInvoker, log?: SkillLog): Promise<StudioSkillTails> {
  const now = Date.now()
  const [vocabulary, rules] = await Promise.all([
    slice(invoker, "operating", VOCABULARY_HEADING, log, now),
    slice(invoker, "authoring", RULES_HEADING, log, now),
  ])
  return { vocabulary, rules }
}
