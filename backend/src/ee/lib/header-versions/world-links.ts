import { safeFetch } from "../../../lib/safe-fetch.js"
import type { LinkAnswer, WorldLink } from "./report-types.js"

/**
 * What each world's address answers. The addresses come from the header's own
 * repository and from the files the sites publish, so they are asked through
 * `safeFetch` (a public address only, every redirect hop checked), each at
 * most `LINK_TIMEOUT_MS`, all at once, and each once per report however many
 * sites lead to it (`askOnce`). Only the status is read; the page itself is
 * never downloaded.
 */

/** Asks one address; resolves to the HTTP status after redirects, or throws when nothing answered. */
export type ProbeLink = (href: string) => Promise<number>

/** What one address answered; never rejects. */
export type AskLink = (href: string) => Promise<LinkAnswer>

export const LINK_TIMEOUT_MS = 8_000

export const probeLink: ProbeLink = async (href) => {
  const res = await safeFetch(href, { method: "GET", timeoutMs: LINK_TIMEOUT_MS, headers: { accept: "text/html", "user-agent": "nodaro-admin-header-versions" } })
  await res.body?.cancel().catch(() => undefined)
  return res.status
}

const timedOut = (error: unknown): boolean => error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")

async function answerOf(probe: ProbeLink, href: string): Promise<LinkAnswer> {
  try {
    return { status: "answered", code: await probe(href) }
  } catch (error) {
    return { status: "no_answer", message: timedOut(error) ? `No answer within ${LINK_TIMEOUT_MS / 1000} seconds.` : "The address could not be reached." }
  }
}

/** Asks each address at most once; every later ask of it gets the same answer. One per report, so a refresh asks again. */
export function askOnce(probe: ProbeLink): AskLink {
  const answers = new Map<string, Promise<LinkAnswer>>()
  return (href) => {
    const known = answers.get(href)
    if (known) return known
    const answer = answerOf(probe, href)
    answers.set(href, answer)
    return answer
  }
}

/** Every world with what its address answered; one that fails never fails the others. */
export function checkWorlds(worlds: readonly Omit<WorldLink, "answer">[], ask: AskLink): Promise<WorldLink[]> {
  return Promise.all(worlds.map(async (world) => ({ ...world, answer: await ask(world.href) })))
}
