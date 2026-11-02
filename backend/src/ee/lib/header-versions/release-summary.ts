import { z } from "zod"
import { llmCompleteStructured } from "../../../lib/llm-client.js"
import type { CommitSummary } from "./github.js"

/**
 * A release of the shared header, said in plain words for the admin reading
 * the Header versions page: its commits are written for developers (prop
 * names, CSS variables, tests). Written once per release and kept — a
 * release's commits never change — in the background, so no page waits on a
 * model: the page shows it from its next build on. Admin-only and
 * platform-paid: no user is charged (`llm-billing-totality.test.ts` holds the
 * exemption).
 */

const SYSTEM = `You explain one release of Nodaro's shared header to the company's admin, who is not a developer.
The shared header is the bar at the top of every Nodaro product site: the logo, the links to the product areas, the language, the credits and the account menu, and on a phone a bar at the bottom.
From the release's commit messages, write at most 50 words in one to three short, plain sentences:
- what changes for the people using the sites;
- which products it affects, and why it was made.
If the change is an option that stays off unless a product turns it on, say plainly that nothing changes for a product that does not.
Name things as people see them on the screen (for example "the links to Explore, Image and Video"), never by the team's internal words for them.
Never name code: no property, file, function, variable, CSS or test names, no version numbers, no pull request numbers.
Plain English. Return only JSON matching the schema.`

const SummarySchema = z.object({ summary: z.string() })

/** Who answers, and for how long; the second model is asked only when the first gave nothing. */
const MODELS = [
  { modelId: "claude-sonnet-5", timeoutMs: 30_000, maxRetries: 1 },
  { modelId: "gemini-3.6-flash", timeoutMs: 20_000, maxRetries: 0 },
] as const

/** Enough of a release's messages to explain it; a longer one is cut. */
const INPUT_CHARS = 12_000
const SUMMARY_CHARS = 600
/** A release no model could explain is asked about again after this long, never on every build. */
const RETRY_AFTER_MS = 60 * 60_000

/** A release's summary if one is written; asking starts it in the background, so a page never waits on a model. */
export type Summarize = (version: string, commits: readonly CommitSummary[]) => string | null

/** Commit trailers name people and sessions, not changes: never sent. */
const TRAILER = /^(?:Co-Authored-By|Claude-Session|Signed-off-by|Reviewed-by):/i

function words(commit: CommitSummary): string {
  const lines = commit.message.split("\n").filter((line) => !TRAILER.test(line.trim()))
  // A merge is read as its pull request's title, never its "Merge pull request" line.
  const kept = commit.parents > 1 ? lines.filter((line) => line.trim() !== "").slice(1) : lines
  return kept.join("\n").trim()
}

/** The messages a model reads, oldest first; past the limit the oldest go, since the release is what its last commits made it. */
function releaseText(version: string, commits: readonly CommitSummary[]): string {
  const body = commits.map(words).filter((m) => m !== "").join("\n\n---\n\n")
  return `Release ${version}\n\n${body.length > INPUT_CHARS ? body.slice(-INPUT_CHARS) : body}`
}

async function askModels(text: string): Promise<string | null> {
  for (const { modelId, timeoutMs, maxRetries } of MODELS) {
    try {
      const { output } = await llmCompleteStructured(
        { modelId, system: SYSTEM, messages: [{ role: "user", content: text }], temperature: 0, maxTokens: 1024, timeoutMs },
        SummarySchema,
        { schemaName: "header_release_summary", maxRetries },
      )
      const summary = output.summary.trim()
      if (summary !== "") return summary.slice(0, SUMMARY_CHARS)
    } catch (error) {
      console.warn(`[header-versions] ${modelId} gave no release summary:`, error instanceof Error ? error.message : error)
    }
  }
  return null
}

/** A release's summary: being written, or written (`null`: no model could). */
interface Kept {
  readonly at: number
  readonly asking: boolean
  readonly summary: string | null
}

/**
 * One summary per release, kept for the life of the process. The first ask
 * starts the writing and answers `null`; a later one answers what was written.
 * Checked and marked in one step, so callers at once start one writing. A
 * release with no commits to read has nothing to explain. `deps` are test seams.
 */
export function createReleaseSummaries(deps: { ask?: (text: string) => Promise<string | null>; now?: () => number } = {}): Summarize {
  const ask = deps.ask ?? askModels
  const now = deps.now ?? Date.now
  const kept = new Map<string, Kept>()
  return (version, commits) => {
    if (commits.length === 0) return null
    const known = kept.get(version)
    if (known && (known.asking || known.summary !== null || now() - known.at < RETRY_AFTER_MS)) return known.summary
    const at = now()
    kept.set(version, { at, asking: true, summary: null })
    void ask(releaseText(version, commits))
      .catch(() => null)
      .then((summary) => kept.set(version, { at, asking: false, summary }))
    return null
  }
}
