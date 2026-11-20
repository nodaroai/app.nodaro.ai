/**
 * A shared prompt as a person reads it (pure): every reference token the
 * prompt bar wrote becomes the name the person saw on its pill.
 *
 *   @<slug>:<N>[:<segment>[:<segment>]][~lock|~nolock]  → @<name>
 *     (images, entities, characters `@kira:1:smile:face`, locations
 *     `@old-library:1:weather/rain`)
 *   {image:N:label} / {video:N:label} / {audio:N:label} → @label
 *   {image:N} / {video:N} / {audio:N}                     → @Image N / @Video N / @Audio N
 *   {ref:<id>[:<role>]}                                   → @<name>
 *
 * The name of an `@` token is the reference whose name's slug (or character /
 * location slug) the token names, as the resolvers bind it — of two with one
 * name the first, unless the Nth is one of them — else the slug itself made
 * readable (`image-1` → `Image 1`). Only names come out of the references,
 * and only into this string: never an address, an id or a role; a name that
 * looks like an address or an id reads as the slug would.
 *
 * `prompt` itself stays exactly as sent; this is display text.
 */
import { imageMentionSlug } from "@nodaro/shared/entities"
import { isAddressOrId } from "./settings.js"

/** One reference as this reads it: what it is called, and every slug a token may name it by. */
interface NamedRef {
  readonly id: string | null
  readonly name: string | null
  readonly slugs: ReadonlySet<string>
}

const SLUG = /^[a-z][a-z0-9-]*$/
const NAME_MAX = 60

const str = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null)

/** A name fit to show: one line, at most `NAME_MAX` characters, never an address or an id. */
function readableName(value: unknown): string | null {
  const name = str(value)?.replace(/\s+/g, " ")
  if (!name || isAddressOrId(name) || /[@{}]/.test(name)) return null
  return Array.from(name).slice(0, NAME_MAX).join("")
}

/** `image-1` → `Image 1`, `old-library` → `Old Library`. */
export function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

/** The references a prompt's tokens may name: `connectedReferences`, then `describedReferences`. */
function namedRefs(inputData: Record<string, unknown>): NamedRef[] {
  const lists = [inputData.connectedReferences, inputData.describedReferences]
  return lists.flatMap((list) =>
    (Array.isArray(list) ? list : []).flatMap((entry): NamedRef[] => {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return []
      const ref = entry as Record<string, unknown>
      const name = readableName(ref.defaultName) ?? readableName(ref.name) ?? readableName(ref.label) ?? readableName(ref.displayName)
      const slugs = new Set<string>()
      for (const value of [ref.defaultName, ref.name, ref.label, ref.displayName]) {
        const s = str(value)
        if (s) slugs.add(imageMentionSlug(s))
      }
      for (const value of [ref.characterSlug, ref.locationSlug, ref.entitySlug, ref.slug]) {
        const s = str(value)
        if (s) slugs.add(s.toLowerCase())
      }
      return [{ id: str(ref.id), name, slugs: new Set([...slugs].filter((s) => SLUG.test(s))) }]
    }),
  )
}

/** The name an `@<slug>:<N>` token shows. */
function nameForMention(refs: readonly NamedRef[], slug: string, index: number): string {
  const matching = refs.filter((r) => r.slugs.has(slug))
  const nth = refs[index - 1]
  const ref = nth && matching.includes(nth) ? nth : matching[0]
  return ref?.name ?? humanizeSlug(slug)
}

// `@slug:N` with up to two more segments (a role, a character's variant and
// mode, a location's `bucket/variant`) and the lock sentinel. The lookbehind
// keeps an email (`me@x.io:2`) out; the trailing lookahead keeps a longer word
// from being cut.
const MENTION = /(?<![A-Za-z0-9])@([a-z][a-z0-9-]*):(\d+)((?::[a-z0-9][a-z0-9_/-]*){0,2})(?:~(?:no)?lock)?(?![A-Za-z0-9_/:-])/g
const EDITOR_TOKEN = /\{(image|video|audio):(\d+)(?::([A-Za-z0-9_-]+))?\}/gi
const REF_TOKEN = /\{ref:([^{}:\s]+)(?::[^{}\s]*)?\}/g

/** The prompt as a person reads it; null for no prompt. */
export function displayPromptOf(prompt: string | null, inputData: unknown): string | null {
  if (prompt === null) return null
  const input = inputData !== null && typeof inputData === "object" && !Array.isArray(inputData) ? (inputData as Record<string, unknown>) : {}
  const refs = namedRefs(input)
  return prompt
    .replace(MENTION, (_token, slug: string, n: string) => `@${nameForMention(refs, slug, Number(n))}`)
    .replace(EDITOR_TOKEN, (_token, kind: string, n: string, label?: string) =>
      label ? `@${label}` : `@${humanizeSlug(kind.toLowerCase())} ${Number(n)}`,
    )
    .replace(REF_TOKEN, (_token, id: string) => `@${refs.find((r) => r.id === id)?.name ?? "reference"}`)
}
