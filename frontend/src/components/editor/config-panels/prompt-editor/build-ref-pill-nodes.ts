import type { JSONContent } from "@tiptap/core"
import { DEFAULT_USAGE_MODE, type UsageMode, type LocationUsageMode } from "@nodaro/shared"
import type { SuggestionCommandPayload } from "./suggestion-list"
import { roleToCharacterRefSlots } from "./character-ref-roles"
import { roleToLocationRefSlots } from "./location-ref-roles"

/**
 * Build the TipTap content nodes for inserting a reference pill, for a resolved
 * `@`-autocomplete / reference-picker item. The SINGLE source of truth for the
 * per-source pill shape — shared by the `@`-suggestion `command` (inserts at the
 * cursor range) and the thumbnail swap-picker (replaces a chip in place).
 *
 * Lifted verbatim from the `prompt-editor/index.tsx` command so the two call
 * sites can't drift. The caller owns positioning (`deleteRange`/`insertContentAt`);
 * this only decides node type + attrs.
 *
 * `mentionIndex` is the unified `@<slug>:N` counter (character + location);
 * image / video / audio use the item's positional `index` instead. A trailing
 * space is appended by default (so the cursor lands ready after an `@` insert);
 * pass `trailingSpace: false` for an in-place swap.
 */
/**
 * Next unified `@<slug>:N` mention index for a prompt — `max(existing N) + 1`.
 * Characters and locations share one positional counter. Scans serialized text
 * (pills round-trip through `renderText`), so raw-typed and pill mentions are
 * counted together. Pure — the caller passes `editor.getText({ blockSeparator:
 * "\n" })`. Shared by the `@`-insert command and the thumbnail swap-picker.
 */
export function nextMentionIndex(text: string): number {
  const seg = "(?:[a-z][a-z0-9-]*\\/[a-z][a-z0-9-]*|[a-z][a-z0-9-]*)"
  const regex = new RegExp(
    `(?:^|[^a-zA-Z0-9])@[a-z][a-z0-9-]*:(\\d+)(?::${seg})?(?::${seg})?`,
    "g",
  )
  let maxIdx = 0
  for (const match of text.matchAll(regex)) {
    const n = parseInt(match[1], 10)
    if (Number.isInteger(n) && n > maxIdx) maxIdx = n
  }
  return maxIdx + 1
}

export function buildRefPillNodes(
  item: SuggestionCommandPayload,
  mentionIndex: number,
  opts?: { trailingSpace?: boolean },
): JSONContent[] {
  const trailing: JSONContent[] = opts?.trailingSpace === false ? [] : [{ type: "text", text: " " }]

  // Location refs → cyan `locationRef` pill. In HYBRID a 3rd-level role pick
  // routes through `roleToLocationRefSlots` (role XOR bucket/variant XOR mode);
  // otherwise bucket/variant come from the picked entry and mode only when
  // explicitly chosen.
  if (item.source === "location" && item.locationSlug) {
    let bucket: string | null
    let variant: string | null
    let roleForNode: string | null
    let locModeForNode: LocationUsageMode | null
    if (item.role != null) {
      const slots = roleToLocationRefSlots(item.role)
      bucket = slots.bucket
      variant = slots.variant
      roleForNode = slots.role
      locModeForNode = slots.usageMode
    } else {
      bucket = item.locationVariantBucket ?? null
      variant = item.locationVariantSlug ?? null
      roleForNode = null
      const explicitLocMode = item.locationUsageMode
      locModeForNode = explicitLocMode != null ? explicitLocMode : null
    }
    return [
      {
        type: "locationRef",
        attrs: {
          locationSlug: item.locationSlug,
          imageIndex: mentionIndex,
          bucket,
          variant,
          usageMode: locModeForNode,
          role: roleForNode,
        },
      },
      ...trailing,
    ]
  }

  // Character refs → violet `characterRef` pill. In HYBRID a role pick routes
  // through `roleToCharacterRefSlots` (usageMode XOR variantSlug); otherwise the
  // variant comes from the picked entry and the mode is emitted only when
  // explicit or a non-default node default.
  if (item.source === "character" && item.characterSlug) {
    let variantSlugForNode: string | null
    let modeForNode: UsageMode | null
    if (item.role != null) {
      const slots = roleToCharacterRefSlots(item.role)
      variantSlugForNode = slots.variantSlug
      modeForNode = slots.usageMode
    } else {
      variantSlugForNode = item.variantSlug ?? null
      const explicitMode = item.usageMode
      const defaultMode = item.defaultUsageMode
      const includeMode = explicitMode != null
        ? true
        : defaultMode != null && defaultMode !== DEFAULT_USAGE_MODE
      modeForNode = includeMode ? (explicitMode ?? defaultMode ?? null) : null
    }
    return [
      {
        type: "characterRef",
        attrs: {
          characterSlug: item.characterSlug,
          imageIndex: mentionIndex,
          variantSlug: variantSlugForNode,
          usageMode: modeForNode,
        },
      },
      ...trailing,
    ]
  }

  // Reference video / audio → `videoRef` / `audioRef`, positional `item.index`.
  if (item.source === "video" || item.source === "audio") {
    return [
      {
        type: item.source === "video" ? "videoRef" : "audioRef",
        attrs: { refIndex: item.index, label: item.defaultLabel },
      },
      ...trailing,
    ]
  }

  // Everything else → the atomic `imageRef` node, positional `item.index`.
  return [
    {
      type: "imageRef",
      attrs: { imageIndex: item.index, label: item.defaultLabel },
    },
    ...trailing,
  ]
}
