import type { ConnectedReference } from "./types.js"
import { characterMentionSlug } from "./character-mention-slug.js"
import { locationMentionSlug } from "./location-mention-slug.js"

/**
 * A bound entity (a wired Character or Location) ready to convert into a
 * `ConnectedReference`. The minimal identity an app captures when a user binds
 * an entity — the SLUG (and thus the resolver match) is DERIVED from `name`
 * here, so callers can't drift from Nodaro's mention resolver. Apps own their
 * own binding UX (chips, pickers); this is just the contract mapping.
 */
export interface EntityReferenceInput {
  /** The entity row id. */
  readonly id: string
  readonly kind: "character" | "location" | "creature"
  /** Display name — the slug is derived from this. */
  readonly name: string
  /** Resolved thumbnail/source URL; null/undefined → "" (placeholder-safe). */
  readonly url?: string | null
  /** Variant slug (e.g. "smile", "rain"); undefined = canonical/default. */
  readonly variant?: string
  /** Optional free-text descriptor (creature bindings: species/appearance) —
   *  folded into the auto-generated directive subject by the prompt builder. */
  readonly description?: string | null
}

/**
 * Map ONE bound entity to its `ConnectedReference`. character → `wired-character`
 * (slug via `characterMentionSlug`), location → `wired-location` (slug via
 * `locationMentionSlug`), creature → `wired-creature` (no mention-slug machinery
 * — like `wired-object`, a bound creature AUTO-ATTACHES and gets a canonical-style
 * creature/animal-subject directive with zero typing; `{image:N:creature}` tokens
 * also resolve against it). Canonical-description fields are null here (a binding
 * captures only name+variant; the picker/full-row path supplies descriptions).
 */
export function toConnectedReference(entity: EntityReferenceInput): ConnectedReference {
  if (entity.kind === "character") {
    return {
      id: entity.id,
      defaultName: entity.name,
      source: "wired-character",
      url: entity.url ?? "",
      characterSlug: characterMentionSlug(entity.name),
      variantSlug: entity.variant,
      characterCanonicalDescription: null,
      variantDescription: null,
      variantDisplayName: entity.variant ?? "canonical",
    }
  }
  if (entity.kind === "creature") {
    return {
      id: entity.id,
      defaultName: entity.name,
      source: "wired-creature",
      url: entity.url ?? "",
      ...(entity.description ? { description: entity.description } : {}),
    }
  }
  return {
    id: entity.id,
    defaultName: entity.name,
    source: "wired-location",
    url: entity.url ?? "",
    locationSlug: locationMentionSlug(entity.name),
    locationCanonicalDescription: null,
    locationVariantBucket: undefined,
    locationVariantSlug: entity.variant,
    locationVariantDisplayName: entity.variant ?? "canonical",
  }
}

/** Batch form — `entities.map(toConnectedReference)`. */
export function toConnectedReferences(
  entities: readonly EntityReferenceInput[],
): ConnectedReference[] {
  return entities.map(toConnectedReference)
}
