/**
 * Assets that take no image seat: the reference walk for a video model whose
 * image references are its FRAMES (a `keyframes` model — Grok Imagine Video 1.5,
 * Kling 4.0 Keyframes; decided 2026-11-11). Only what is wired into the node's
 * Image References becomes a frame, so a wired character, a character extra or
 * an entity attaches no picture and is numbered nowhere: no `@image_N` may point
 * at a picture that is never sent.
 *
 * What a character still gives is its identity text — its name and description,
 * the one line both reference formats render for a described reference — and a
 * mention of it (`@kira:1`, `@kira:1:smile`) or a `{ref:<id>}` naming it reads as
 * its name. A non-character extra or entity adds nothing.
 *
 * Pure: no I/O, no mutation of inputs. `resolveVideoReferenceCore` calls it when
 * its caller passes `assetsTakeNoSeat`.
 */

import { DEFAULT_USAGE_MODE, findCharacterMentionTokens, type UsageMode } from "@nodaro/shared/entities"
import type { ConnectedReference, DescribedReference } from "@nodaro/shared/types"

/** The fields of a video extra this walk reads (structural: `VideoExtraRef` fits). */
export interface SeatlessExtraRef {
  id?: string
  characterSlug?: string
  description?: string
  descriptionOverride?: string
  usageMode?: UsageMode
  elementInjection?: string | null
}

/** The fields of a character's metadata this walk reads (structural: `CharacterMeta` fits). */
export interface SeatlessCharacterMeta {
  characterName?: string
  defaultUsageMode?: UsageMode
  canonicalDescription?: string
}

export interface SeatlessAssets {
  /** The prompt with every wired character's mention replaced by its name. */
  prompt: string | undefined
  /** One name + description per character with an identity to give, in wiring order. */
  identities: DescribedReference[]
  /** `{ref:<id>}` names for the character extras, which the walk seats nowhere. */
  extraNamesById: Map<string, string>
}

/**
 * The identity text a seatless character gives. Mirrors what the legacy
 * canonical line puts after the name — the per-use override in every mode that
 * renders a line, else the stored description in the modes that carry it, then
 * the wired element injection — minus the usage directive, which instructs how
 * to use a picture the model does not receive.
 */
function identityDescription(
  mode: UsageMode,
  override: string | null | undefined,
  canonical: string | null | undefined,
  injection: string | null | undefined,
): string {
  if (mode === "none" || mode === "name") return ""
  const parts: string[] = []
  const o = override?.trim()
  const c = canonical?.trim()
  if (o) parts.push(o)
  else if ((mode === "identical" || mode === "face-pose") && c) parts.push(c)
  const i = injection?.trim()
  if (i) parts.push(i)
  return parts.join(". ")
}

export function resolveSeatlessAssets(args: {
  prompt: string | undefined
  /** Every wired character reference, BEFORE canonical suppression. */
  wiredCharRefs: readonly ConnectedReference[]
  /** Character slugs whose canonical fallback the user hid. */
  suppressedCanonicalSlugs: ReadonlySet<string>
  extraRefs?: readonly SeatlessExtraRef[]
  lookupCharacterBySlug?: (slug: string) => SeatlessCharacterMeta | undefined
}): SeatlessAssets {
  // The reference each wired character is described from: its canonical entry,
  // else the first entry wired for it.
  const bySlug = new Map<string, ConnectedReference>()
  for (const r of args.wiredCharRefs) {
    if (r.source !== "wired-character" || !r.characterSlug) continue
    const known = bySlug.get(r.characterSlug)
    if (!known || (known.variantSlug && !r.variantSlug)) bySlug.set(r.characterSlug, r)
  }
  const nameOf = (slug: string): string => {
    const r = bySlug.get(slug)
    return r?.defaultName || r?.characterSlug || slug
  }

  // Mentions read as the character's name (right to left, so offsets hold).
  let prompt = args.prompt
  const mentioned = new Set<string>()
  if (prompt && bySlug.size > 0) {
    const tokens = findCharacterMentionTokens(prompt, [...bySlug.keys()])
    for (const t of [...tokens].sort((a, b) => b.offset - a.offset)) {
      mentioned.add(t.characterSlug)
      prompt = prompt.slice(0, t.offset) + nameOf(t.characterSlug) + prompt.slice(t.offset + t.token.length)
    }
  }

  const identities: DescribedReference[] = []
  const described = new Set<string>()
  const describe = (slug: string, name: string, description: string): void => {
    if (described.has(slug)) return
    described.add(slug)
    if (description) identities.push({ name, description })
  }

  // A wired character gives its identity unless the user hid its canonical
  // fallback and the prompt does not mention it either.
  for (const [slug, r] of bySlug) {
    const shown = !args.suppressedCanonicalSlugs.has(slug) || mentioned.has(slug)
    if (!shown) continue
    describe(
      slug,
      nameOf(slug),
      identityDescription(r.defaultUsageMode ?? DEFAULT_USAGE_MODE, r.descriptionOverride, r.characterCanonicalDescription, r.elementInjection),
    )
  }

  // A character extra (a variant picked on the node) speaks for its character
  // once; a non-character extra has no frame and no text.
  const extraNamesById = new Map<string, string>()
  for (const ex of args.extraRefs ?? []) {
    if (!ex.characterSlug) continue
    const meta = args.lookupCharacterBySlug?.(ex.characterSlug)
    const name = bySlug.has(ex.characterSlug) ? nameOf(ex.characterSlug) : meta?.characterName || ex.characterSlug
    if (ex.id) extraNamesById.set(ex.id, name)
    const own = (ex.descriptionOverride ?? "").trim() || (ex.description ?? "").trim()
    describe(
      ex.characterSlug,
      name,
      identityDescription(ex.usageMode ?? meta?.defaultUsageMode ?? DEFAULT_USAGE_MODE, own, meta?.canonicalDescription, ex.elementInjection),
    )
  }

  return { prompt, identities, extraNamesById }
}
