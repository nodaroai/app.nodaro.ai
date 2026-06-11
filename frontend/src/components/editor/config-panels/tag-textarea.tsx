import { useState, useRef, useCallback, useMemo, useEffect, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Textarea } from "@/components/ui/textarea"
import { AUDIO_TAGS, SSML_BREAK_OPTIONS, isV2Model } from "@/lib/audio-tags"
import type { NodeRefItem } from "@/lib/node-refs"
import type { VariableDisplayMode } from "./types"
import { renderNodeRefs } from "@/lib/render-node-refs"
import { optimizedImageUrl } from "@/lib/image"
import { filterSnippets, computeSnippetInsertPrefix, type SnippetPoolItem } from "@/lib/snippet-pool"
import { USAGE_MODES, DEFAULT_USAGE_MODE, usageModeLabel, type UsageMode } from "@nodaro/shared"

/** Regex to match bracket tags like [whispers], [Verse 2], <break time="1s" /> */
const TAG_PATTERN = /(\[[^\]]+\]|<break[^>]*\/>)/g

/** Combined pattern for highlighting both tags and node refs */
const COMBINED_PATTERN = /(\[[^\]]+\]|<break[^>]*\/>|\{[^}]+\})/g

/** Node-ref-only pattern used when tagMode is "none" but there are node refs */
const NODE_REF_PATTERN = /(\{[^}]+\})/g

interface BaseProps {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly placeholder?: string
  readonly rows?: number
  readonly className?: string
  readonly maxLength?: number
  readonly nodeRefs?: readonly NodeRefItem[]
  readonly referenceImages?: readonly RefImageItem[]
  readonly displayMode?: VariableDisplayMode
  readonly refMap?: Map<string, string>
  /** Snippet pool for this field (target+media filtered). Enables the "/"
   *  snippets dropdown when tagMode is "none" (negative-prompt fields).
   *  tagMode "audio"/"suno" keep their existing "/" audio-tag behavior. */
  readonly snippets?: readonly SnippetPoolItem[]
}

type TagTextareaProps = BaseProps & (
  | { tagMode?: "none" }
  | { tagMode: "audio"; provider?: string }
  | { tagMode: "suno"; customTags: readonly SuggestionItem[] }
)

export interface SuggestionItem {
  tag: string
  label: string
  category: string
  thumbnailUrl?: string
  /** Variant display name for ref-image suggestions (e.g. "smile"). Hidden when "canonical" or absent. */
  variantDisplayName?: string
  /**
   * Discriminator for the `@` autocomplete's hierarchical view. Absent for
   * normal flat suggestions (audio tags, SSML breaks, node refs, non-character
   * refs).
   *
   *  - "character-root": clicking drills into the character's variants.
   *    `tag` is the bare `@<characterSlug>` (used if the user presses Enter
   *    without drilling).
   *  - "variant": leaf variant inside the drill-in view. `tag` is the full
   *    `@<character>:<variant>` slug. Clicking inserts and closes.
   *  - "mode": one row per usage mode in the 3rd-level mode-picker drill.
   *    `mode` carries the chosen `UsageMode`. Selecting inserts the slug
   *    with the mode appended as the 4th segment.
   *  - "back": back row at the top of drill-in view. `tag` is unused.
   *  - undefined / "leaf": ordinary leaf (insert + close).
   */
  kind?: "character-root" | "variant" | "back" | "leaf" | "mode" | "location-root" | "location-variant"
  /** Slug of the character this root row represents — used to drill in. */
  characterSlug?: string
  /**
   * Slug of the location this row represents (for `kind: "location-root"` and
   * `kind: "location-variant"`). Mirrors `characterSlug` — the autocomplete's
   * selectSuggestion path inserts `@<locationSlug>:N(:<bucket>/<variant>)?`
   * pills via the TipTap `locationRef` atomic node.
   */
  locationSlug?: string
  /**
   * Location variant bucket (e.g. "weather", "lighting") for
   * `kind: "location-variant"` rows. Combined with `locationVariantSlug`
   * to form the `:bucket/variant` slug segment.
   */
  locationVariantBucket?: string
  /** Location variant slug (e.g. "rain", "neon") for `kind: "location-variant"` rows. */
  locationVariantSlug?: string
  /** Display name of the location variant (e.g. "rain", "canonical") for UI rendering. */
  locationVariantDisplayName?: string
  /** When `kind === "mode"`, the usage mode chosen by this row. */
  mode?: UsageMode
  /**
   * Character node's `defaultUsageMode`. Carried through from the source
   * `RefImageItem` so `selectSuggestion` can append the trailing `:<mode>`
   * segment to the inserted slug when the character has a non-default mode
   * (keeps the casual `@kira:1:smile` insertion clean for the common case).
   */
  defaultUsageMode?: UsageMode
  /** When set, this row is a prompt snippet — selecting inserts this text
   *  (with smart separator) instead of `tag`. `tag` holds a truncated preview. */
  snippetText?: string
  /** Unique pool identity for snippet rows — keys + dedupe; absent for non-snippet rows. */
  snippetId?: string
}

/** A reference image that can be inserted into the prompt via the "@" trigger. */
export interface RefImageItem {
  readonly url: string
  readonly label: string
  /**
   * Discriminator for how the autocomplete renders this row and what kind of
   * pill `selectSuggestion` inserts:
   *   - "uploaded" / "wired": legacy `{image:N:label}` ref (TipTap `imageRef` node)
   *   - "character": violet `@<charSlug>:N(:variant)(:mode)` pill (TipTap `characterRef` node)
   *   - "location":  cyan   `@<locSlug>:N(:bucket/variant)(:mode)`  pill (TipTap `locationRef` node)
   */
  readonly source: "uploaded" | "wired" | "character" | "location"
  /** 1-based position matching {image:N} in the prompt. */
  readonly index: number
  /** Default role label inserted by the "@" trigger (e.g. "object", "person"). */
  readonly defaultLabel: string
  /** When source === "character", the slug for the character (e.g. "kira"). */
  readonly characterSlug?: string
  /** When source === "character", the slug for the variant (e.g. "smile"). undefined = canonical. */
  readonly variantSlug?: string
  /** Variant display name for the autocomplete (e.g. "smile", "canonical"). */
  readonly variantDisplayName?: string
  /**
   * When `source === "location"`, the slug for the location (e.g. "old-library").
   * Mirrors `characterSlug` — used by the location-aware autocomplete to group
   * entries by location and by `LocationRefView` to resolve thumbnails.
   */
  readonly locationSlug?: string
  /**
   * When `source === "location"` and this entry represents a per-variant asset,
   * the bucket the variant came from — one of "timeOfDay" / "weather" /
   * "seasons" / "angles" / "lighting" / "atmosphereMotions". `undefined` for
   * the canonical main-image entry of a location.
   *
   * The bucket is the disambiguator between the two location slug forms:
   *   - canonical:  `@oldlibrary:1`
   *   - per-variant: `@oldlibrary:1:weather/rain`
   * Two variants from different buckets may share a name (`weather/sunset`
   * vs `lighting/sunset`); the bucket prefix forces the resolver to pull
   * from the right array.
   */
  readonly locationVariantBucket?: string
  /**
   * When `source === "location"` and this entry represents a per-variant asset,
   * the variant slug (e.g. "rain", "neon"). Mirrors `variantSlug` on the
   * character side. Combined with `locationVariantBucket` to form the
   * `:bucket/variant` slug segment.
   */
  readonly locationVariantSlug?: string
  /**
   * When `source === "location"`, display name for the variant in the
   * autocomplete UI (e.g. "rain", "canonical"). Mirrors `variantDisplayName`
   * on the character side.
   */
  readonly locationVariantDisplayName?: string
  /**
   * Character node's `defaultUsageMode`. Mirrors the field on the underlying
   * `ConnectedReference` (see `packages/shared/src/types.ts`) so the
   * autocomplete can decide whether the inserted slug needs a trailing
   * `:mode` segment — only added when the mode is non-default so casual users
   * never see the 4-part form they don't need. The prompt-builder still falls
   * back to this same value at execution time when the slug omits the mode,
   * so insertion is purely a UX/display concern.
   */
  readonly defaultUsageMode?: UsageMode
  /**
   * Character LoRA training status, propagated from the upstream character
   * node's `loraTrainingStatus`. Drives the `<TrainedPill>` next to the
   * character name in the autocomplete root view — display-only, mirrors the
   * canvas card badge. When `"succeeded"`, generations using this character
   * route through the trained LoRA (see `selectLoraRoutingForMentions`).
   */
  readonly loraTrainingStatus?: string | null
}

type TriggerChar = "[" | "<" | "/" | "{" | "@"

const REF_IMAGE_SOURCE_LABEL: Record<RefImageItem["source"], string> = {
  uploaded: "Uploaded",
  wired: "Wired",
  character: "Character",
  location: "Location",
}

function getAllSuggestions(): SuggestionItem[] {
  const items: SuggestionItem[] = AUDIO_TAGS.map((t) => ({
    tag: t.tag,
    label: t.label,
    category: t.category,
  }))
  for (const b of SSML_BREAK_OPTIONS) {
    items.push({ tag: b.tag, label: b.label, category: "SSML Breaks" })
  }
  return items
}

const ALL_SUGGESTIONS = getAllSuggestions()

/**
 * Scan the current prompt for existing `@<char>:<N>(:<variant>)?` tokens and
 * return the next free index (max found + 1). Used by the `@` autocomplete
 * when inserting a new mention so each character mention carries a stable
 * positional index the user can trace to the final prompt's identity directive
 * (`Image N (Name)`).
 *
 * Bare `@foo` tokens are no longer valid mentions (the index segment is
 * required), so they don't participate in the count.
 */
function computeNextMentionIndex(promptValue: string): number {
  // Matches `@<char>:<N>(:<variant|mode>)?(:<mode>)?` and captures N. Mirrors
  // the shared `findCharacterMentionTokens` regex shape so we count the same
  // tokens — the two optional trailing groups absorb the 4-part
  // (variant + mode) form too.
  const regex = /(?:^|[^a-zA-Z0-9])@[a-z][a-z0-9-]*:(\d+)(?::[a-z][a-z0-9-]*)?(?::[a-z][a-z0-9-]*)?/g
  let maxIndex = 0
  for (const match of promptValue.matchAll(regex)) {
    const n = parseInt(match[1], 10)
    if (Number.isInteger(n) && n > maxIndex) maxIndex = n
  }
  return maxIndex + 1
}

const SSML_SUGGESTIONS: SuggestionItem[] = SSML_BREAK_OPTIONS.map((b) => ({
  tag: b.tag,
  label: b.label,
  category: "SSML Breaks",
}))

/** Map node type to a human-readable category for the dropdown */
function nodeTypeCategory(type: string): string {
  if (["text-prompt", "ai-writer", "llm-chat", "list"].includes(type)) return "Text"
  if (["generate-image", "upload-image", "edit-image", "image-to-image", "character", "face", "object", "location", "scene"].includes(type)) return "Image"
  if (["image-to-video", "text-to-video", "video-to-video", "upload-video", "youtube-video", "combine-videos", "extend-video"].includes(type)) return "Video"
  if (["text-to-speech", "generate-music", "text-to-audio", "upload-audio", "suno-generate"].includes(type)) return "Audio"
  return "Node"
}

export function TagTextarea(props: TagTextareaProps) {
  const { value, onChange, placeholder, rows, className, maxLength, nodeRefs, referenceImages, displayMode = "raw", refMap, snippets } = props
  const tagMode: "audio" | "suno" | "none" = props.tagMode ?? "none"
  const provider = props.tagMode === "audio" ? props.provider : undefined
  const customTags = props.tagMode === "suno" ? props.customTags : undefined
  const [showDropdown, setShowDropdown] = useState(false)
  const [triggerInfo, setTriggerInfo] = useState<{ char: TriggerChar; position: number } | null>(null)
  const [filterText, setFilterText] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [warning, setWarning] = useState<string | null>(null)
  const [imagePreview, setImagePreview] = useState<{ url: string; anchor: DOMRect } | null>(null)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null)
  // Drill-in state for the `@` autocomplete — TWO levels:
  //   `drillCharacterSlug`: when non-null, the dropdown shows that character's
  //                         variants instead of the root character list.
  //   `drillVariant`: when non-null, the dropdown shows the 6 usage modes
  //                   (3rd-level mode-picker drill). Selecting a mode inserts
  //                   the slug with `:mode` appended as the 4th segment.
  const [drillCharacterSlug, setDrillCharacterSlug] = useState<string | null>(null)
  const [drillVariant, setDrillVariant] = useState<{
    characterSlug: string
    variantSlug: string | null
    variantDisplayName: string | null
    item: RefImageItem
  } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  const nodeRefSuggestions = useMemo((): SuggestionItem[] => {
    if (!nodeRefs || nodeRefs.length === 0) return []
    return nodeRefs.map((ref) => ({
      tag: `{${ref.label}}`,
      label: ref.label,
      category: nodeTypeCategory(ref.type),
    }))
  }, [nodeRefs])

  // Hybrid autocomplete for the `@` trigger:
  //
  //   Empty filter (just `@` typed): HIERARCHICAL root view — 1 entry per
  //              character (canonical thumbnail + name) + non-character refs
  //              (uploaded / wired-image) as ordinary leaves. Selecting a
  //              character drills in instead of inserting.
  //
  //   Drill-in: "← back (Name)" row + that character's variants. Selecting a
  //              variant inserts `@<char>:N:<variant>` and closes the popup.
  //
  //   Non-empty filter (user typed something after `@`): FLAT search — every
  //              character ref (canonical + variants) plus matching
  //              non-character refs, filtered by character name, variant name,
  //              character slug, or variant slug. Each row shows the full path
  //              ("Kira / smile") so users distinguish identically-named
  //              variants across characters. Drill-in is bypassed; selecting
  //              a result inserts directly.
  //
  // Non-character refs (`source !== "character"`) always use the legacy
  // `{image:N:role}` token in both modes.
  const refImageSuggestions = useMemo((): SuggestionItem[] => {
    if (!referenceImages || referenceImages.length === 0) return []

    // Bucket character refs by characterSlug; keep non-character refs flat.
    const characterGroups = new Map<string, RefImageItem[]>()
    const nonCharacterItems: RefImageItem[] = []
    for (const item of referenceImages) {
      if (item.source === "character" && item.characterSlug) {
        const group = characterGroups.get(item.characterSlug) ?? []
        group.push(item)
        characterGroups.set(item.characterSlug, group)
      } else {
        nonCharacterItems.push(item)
      }
    }

    const q = filterText.trim().toLowerCase()

    // MODE PICKER (3rd-level drill). When the user has drilled into a
    // specific variant, surface USAGE_MODES so they can pick the per-mention
    // mode override. Typing filters by label/key.
    if (drillVariant) {
      const variantName = drillVariant.variantDisplayName ?? "canonical"
      const backLabel = `back (${variantName})`
      const modeCategory = "Usage mode"
      const matchingModes = q.length > 0
        ? USAGE_MODES.filter((m) =>
            usageModeLabel(m).toLowerCase().includes(q) || m.toLowerCase().includes(q),
          )
        : USAGE_MODES
      return [
        {
          kind: "back",
          tag: "__back__",
          label: backLabel,
          category: modeCategory,
        },
        ...matchingModes.map((m): SuggestionItem => ({
          kind: "mode",
          tag: `:${m}`,
          label: usageModeLabel(m),
          category: modeCategory,
          mode: m,
        })),
      ]
    }

    // FLAT SEARCH MODE — when the user has typed something after `@`,
    // surface every character ref (canonical + variants) so typing
    // `@smile` finds Kira's smile expression directly. Filter matches
    // character name, variant name, character slug, or variant slug.
    if (q.length > 0) {
      const flatCategory = "Search"
      const matches: SuggestionItem[] = []
      for (const [slug, group] of characterGroups) {
        const canonical = group.find((i) => !i.variantSlug) ?? group[0]
        const charName = (canonical.label || slug).toLowerCase()
        for (const v of group) {
          const variantName = (v.variantDisplayName ?? "").toLowerCase()
          const variantSlug = (v.variantSlug ?? "").toLowerCase()
          const fullSlug = v.variantSlug ? `${slug}:${variantName}` : slug
          // Legacy hyphen form (e.g. "kira-smile") for compatibility with users
          // who type the old slug shape.
          const legacySlug = v.variantSlug ? `${slug}-${variantSlug}` : slug
          if (
            charName.includes(q)
            || variantName.includes(q)
            || slug.toLowerCase().includes(q)
            || variantSlug.includes(q)
            || fullSlug.includes(q)
            || legacySlug.includes(q)
          ) {
            // Render the full path ("Kira / smile") in flat-search mode so
            // users distinguish identically-named variants across characters.
            // The render layer appends `/ variantDisplayName` when present,
            // so we MUST omit variantDisplayName here to avoid double-suffix
            // ("Kira / smile / smile"). The canonical ref drops the suffix.
            const displayLabel = v.variantDisplayName && v.variantDisplayName !== "canonical"
              ? `${canonical.label} / ${v.variantDisplayName}`
              : canonical.label
            matches.push({
              kind: "variant",
              tag: v.variantSlug
                ? `@${v.characterSlug}:${v.variantSlug}`
                : `@${v.characterSlug}`,
              label: displayLabel,
              category: flatCategory,
              thumbnailUrl: v.url,
              // Intentionally omitted: see displayLabel comment.
              characterSlug: v.characterSlug,
              defaultUsageMode: v.defaultUsageMode,
            })
          }
        }
      }
      // Non-character refs filtered by label, index, or default-label.
      const nonCharMatches: SuggestionItem[] = []
      for (const r of nonCharacterItems) {
        if (
          r.label.toLowerCase().includes(q)
          || String(r.index).includes(q)
          || r.defaultLabel.toLowerCase().includes(q)
        ) {
          nonCharMatches.push({
            kind: "leaf",
            tag: `{image:${r.index}:${r.defaultLabel}}`,
            label: `#${r.index} ${r.label}`,
            category: REF_IMAGE_SOURCE_LABEL[r.source],
            thumbnailUrl: r.url,
          })
        }
      }
      return [...matches, ...nonCharMatches]
    }

    // Drill-in view: that character's variants + back row.
    if (drillCharacterSlug) {
      const variants = characterGroups.get(drillCharacterSlug) ?? []
      const canonical = variants.find((v) => !v.variantSlug)
      const characterName = canonical?.label ?? drillCharacterSlug
      const backLabel = `back (${characterName})`
      // Single category bucket keeps the back row visually attached to the
      // variant list and avoids two separate category headers.
      const drillCategory = `${characterName} variants`
      return [
        {
          kind: "back",
          tag: "__back__",
          label: backLabel,
          category: drillCategory,
        },
        ...variants.map((v): SuggestionItem => ({
          kind: "variant",
          tag: v.variantSlug
            ? `@${v.characterSlug}:${v.variantSlug}`
            : `@${v.characterSlug}`,
          label: v.variantDisplayName ?? v.label,
          category: drillCategory,
          thumbnailUrl: v.url,
          variantDisplayName: v.variantDisplayName,
          characterSlug: v.characterSlug,
          defaultUsageMode: v.defaultUsageMode,
        })),
      ]
    }

    // Root view (empty filter): one entry per character + non-character refs.
    const characterRoots: SuggestionItem[] = []
    for (const [slug, items] of characterGroups) {
      const canonical = items.find((i) => !i.variantSlug) ?? items[0]
      const variantCount = items.length
      characterRoots.push({
        kind: "character-root",
        tag: `@${slug}`,
        label: canonical.label,
        category: REF_IMAGE_SOURCE_LABEL[canonical.source],
        thumbnailUrl: canonical.url,
        characterSlug: slug,
        // Hint at how many variants are available behind the drill-in.
        variantDisplayName: variantCount > 1 ? `${variantCount} variants` : undefined,
      })
    }
    const nonCharacterLeaves: SuggestionItem[] = nonCharacterItems.map((r) => ({
      kind: "leaf",
      tag: `{image:${r.index}:${r.defaultLabel}}`,
      label: `#${r.index} ${r.label}`,
      category: REF_IMAGE_SOURCE_LABEL[r.source],
      thumbnailUrl: r.url,
    }))
    return [...nonCharacterLeaves, ...characterRoots]
  }, [referenceImages, drillCharacterSlug, drillVariant, filterText])

  // Filter character-aware suggestions internally (the memo above already
  // applies the query in flat-search mode and ignores it in root/drill mode).
  // Apply the legacy substring filter to non-`@` suggestions so audio tags,
  // SSML breaks, and node refs still respect the filter.
  const filtered = useMemo(() => {
    if (!showDropdown || !triggerInfo) return []
    const q = filterText.toLowerCase()

    if (triggerInfo.char === "@") {
      // refImageSuggestions already applied query-aware filtering.
      return refImageSuggestions
    }

    if (triggerInfo.char === "/" && tagMode === "none") {
      return filterSnippets(snippets ?? [], filterText).slice(0, 50).map((s): SuggestionItem => ({
        tag: s.text.length > 44 ? `${s.text.slice(0, 44)}…` : s.text,
        label: s.name,
        category: s.category,
        kind: "leaf",
        snippetText: s.text,
        snippetId: `${s.source}:${s.id}`,
      }))
    }

    let items: readonly SuggestionItem[]
    if (triggerInfo.char === "{") {
      items = nodeRefSuggestions
    } else if (tagMode === "suno") {
      if (!customTags) return []
      if (triggerInfo.char === "<") return []
      items = customTags
    } else if (tagMode === "audio") {
      items = triggerInfo.char === "<" ? SSML_SUGGESTIONS : ALL_SUGGESTIONS
    } else {
      return []
    }

    if (!q) return items
    // Back rows always stay visible — they're navigation, not data.
    return items.filter((s) => s.kind === "back" || s.label.toLowerCase().includes(q) || s.category.toLowerCase().includes(q))
  }, [showDropdown, triggerInfo, filterText, customTags, nodeRefSuggestions, refImageSuggestions, tagMode, snippets])

  const groupedFiltered = useMemo(() => {
    const map = new Map<string, SuggestionItem[]>()
    for (const item of filtered) {
      const existing = map.get(item.category) ?? []
      existing.push(item)
      map.set(item.category, existing)
    }
    return map
  }, [filtered])

  const dismiss = useCallback(() => {
    setShowDropdown(false)
    setTriggerInfo(null)
    setFilterText("")
    setSelectedIndex(0)
    setWarning(null)
    setDropdownPos(null)
    setDrillCharacterSlug(null)
    setDrillVariant(null)
  }, [])

  // Compute dropdown position relative to viewport. Flips above the textarea
  // when there isn't enough room below, and caps the height so the list is
  // always scrollable within view — previously opened below only and got
  // clipped off-screen near the bottom of the config panel.
  const updateDropdownPos = useCallback(() => {
    if (!wrapperRef.current) return
    const rect = wrapperRef.current.getBoundingClientRect()
    const vh = window.innerHeight
    const MARGIN = 8
    const IDEAL_MAX_H = 300 // matches the popup's max-h cap
    const spaceBelow = Math.max(0, vh - rect.bottom - MARGIN)
    const spaceAbove = Math.max(0, rect.top - MARGIN)
    // Prefer below, but flip if there's more room above and below is tight.
    const flipUp = spaceBelow < 160 && spaceAbove > spaceBelow
    if (flipUp) {
      const maxHeight = Math.min(IDEAL_MAX_H, spaceAbove)
      setDropdownPos({
        top: rect.top - maxHeight - 4,
        left: rect.left,
        width: rect.width,
        maxHeight,
      })
    } else {
      setDropdownPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        maxHeight: Math.min(IDEAL_MAX_H, spaceBelow),
      })
    }
  }, [])

  const insertTag = useCallback((tag: string) => {
    if (!triggerInfo || !textareaRef.current) return

    const before = value.slice(0, triggerInfo.position)
    const cursorPos = textareaRef.current.selectionStart
    const after = value.slice(cursorPos)

    const newValue = before + tag + " " + after
    if (maxLength && newValue.length > maxLength) return

    onChange(newValue)

    if (tagMode === "audio") {
      const isAudioTag = tag.startsWith("[")
      const isSsmlTag = tag.startsWith("<")
      if (isSsmlTag && provider !== undefined && !isV2Model(provider)) {
        setWarning("SSML breaks work best with Turbo v2.5 or Multilingual v2")
      } else if (isAudioTag && provider !== undefined && isV2Model(provider)) {
        setWarning("Audio tags like " + tag + " work best with ElevenLabs v3")
      }
    }

    dismiss()

    // Restore cursor
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        const newPos = before.length + tag.length + 1
        textareaRef.current.selectionStart = newPos
        textareaRef.current.selectionEnd = newPos
        textareaRef.current.focus()
      }
    })
  }, [triggerInfo, value, onChange, maxLength, provider, tagMode, dismiss])

  // Trim any filter text the user has typed between `@` and the cursor.
  // Used when transitioning between drill states so the new view starts
  // with an empty filter. `filterText` is derived from the textarea content,
  // so we have to actually delete the characters there too.
  const clearFilterTextInTextarea = useCallback(() => {
    if (!triggerInfo || !textareaRef.current) return
    const before = value.slice(0, triggerInfo.position + 1) // keep the `@`
    const cursorPos = textareaRef.current.selectionStart
    const after = value.slice(cursorPos)
    if (cursorPos <= triggerInfo.position + 1) return // nothing to clear
    onChange(before + after)
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        const newPos = triggerInfo.position + 1
        textareaRef.current.selectionStart = newPos
        textareaRef.current.selectionEnd = newPos
        textareaRef.current.focus()
      }
    })
  }, [triggerInfo, value, onChange])

  // Drill into the 3rd-level mode picker for a given variant SuggestionItem.
  // The chip on each variant row (level-2 drill) and the right-arrow key both
  // call this; `selectSuggestion` itself never lands here (Enter on a variant
  // inserts with the default mode — legacy behavior preserved).
  const drillIntoMode = useCallback((item: SuggestionItem) => {
    if (item.kind !== "variant" || !item.characterSlug || !referenceImages) return
    // Recover the underlying RefImageItem so the eventual insertion has
    // access to the character's defaultUsageMode (used as the fallback if
    // the user later switches back to default).
    const variantSlugFromTag = item.tag.startsWith(`@${item.characterSlug}:`)
      ? item.tag.slice(item.characterSlug.length + 2)
      : ""
    const matchingRef = referenceImages.find(
      (r) => r.characterSlug === item.characterSlug
        && ((variantSlugFromTag === "" && !r.variantSlug) || r.variantSlug === variantSlugFromTag),
    )
    if (!matchingRef) return
    const variantDisplayName = item.variantDisplayName && item.variantDisplayName !== "canonical"
      ? item.variantDisplayName
      : null
    setDrillVariant({
      characterSlug: item.characterSlug,
      variantSlug: matchingRef.variantSlug ?? null,
      variantDisplayName,
      item: matchingRef,
    })
    // Skip the back row so the first usage-mode row is highlighted by default.
    setSelectedIndex(1)
    setFilterText("")
    clearFilterTextInTextarea()
  }, [referenceImages, clearFilterTextInTextarea])

  // Click handler for the `@` autocomplete that's aware of the hierarchical
  // kinds. Back rows pop one level, character-root rows push to level 2, mode
  // rows insert with the chosen mode, leaf/variant rows fall through to
  // `insertTag` and close the popup.
  //
  // Character variant insertions (`kind === "variant"`) get rewritten from
  // `@kira` / `@kira:smile` to `@kira:N` / `@kira:N:smile`, where N is the
  // next available index in the current prompt. The numeric index lets the
  // user trace each `@-mention` to its corresponding `Image N (Name)` bullet
  // in the final assembled identity directive block.
  const selectSuggestion = useCallback((item: SuggestionItem) => {
    if (item.snippetText !== undefined) {
      const prevChar = triggerInfo && triggerInfo.position > 0 ? value[triggerInfo.position - 1] : ""
      // The "/" trigger only fires at line-start or after whitespace, so prevChar
      // here is always start/whitespace and the computed prefix is effectively "".
      // We still route through the shared helper for uniformity with the
      // button/TipTap snippet-insert paths, where prevChar is unconstrained.
      insertTag(computeSnippetInsertPrefix(prevChar) + item.snippetText)
      return
    }
    if (item.kind === "back") {
      // Pop one level: mode picker → variant list; variant list → root.
      if (drillVariant) {
        setDrillVariant(null)
      } else {
        setDrillCharacterSlug(null)
      }
      setSelectedIndex(0)
      setFilterText("")
      clearFilterTextInTextarea()
      return
    }
    if (item.kind === "character-root" && item.characterSlug) {
      setDrillCharacterSlug(item.characterSlug)
      // Skip the back row so the first variant is highlighted by default.
      setSelectedIndex(1)
      setFilterText("")
      clearFilterTextInTextarea()
      return
    }
    if (item.kind === "mode" && item.mode && drillVariant) {
      // 3rd-level mode insertion. Always emit the 4th `:mode` slug segment —
      // this is the user's explicit choice, so it must round-trip even when
      // equal to the character's default (otherwise the picker is a no-op).
      const before = triggerInfo ? value.slice(0, triggerInfo.position) : ""
      const cursorPos = textareaRef.current?.selectionStart ?? value.length
      const after = value.slice(cursorPos)
      const promptForCount = before + after
      const nextIndex = computeNextMentionIndex(promptForCount)
      const parts = [`@${drillVariant.characterSlug}:${nextIndex}`]
      if (drillVariant.variantSlug) parts.push(drillVariant.variantSlug)
      parts.push(item.mode)
      insertTag(parts.join(":"))
      return
    }
    let tag = item.tag
    if (item.kind === "variant" && item.characterSlug) {
      // Compute the prompt slice that will remain in the textarea after
      // insertion: everything BEFORE the `@` trigger + everything AFTER the
      // cursor. The to-be-inserted token contributes no existing index of
      // its own, so the count from that slice is the right starting point.
      const before = triggerInfo ? value.slice(0, triggerInfo.position) : ""
      const cursorPos = textareaRef.current?.selectionStart ?? value.length
      const after = value.slice(cursorPos)
      const promptForCount = before + after
      const nextIndex = computeNextMentionIndex(promptForCount)
      // Reconstruct from the character's slug + computed index + variant.
      // Bare `@<slug>` (canonical) becomes `@<slug>:<N>`; `@<slug>:<variant>`
      // becomes `@<slug>:<N>:<variant>`. The 4th `:mode` segment is appended
      // only when the source character node has a non-default `defaultUsageMode`
      // — this keeps the common case (`identical`) on the 2/3-part form the
      // textarea users are already used to.
      const variantSlug = item.tag.startsWith(`@${item.characterSlug}:`)
        ? item.tag.slice(item.characterSlug.length + 2)
        : ""
      const mode = item.defaultUsageMode
      // Skip emitting the trailing `:mode` for the default mode so casual
      // users (no mode configured on the node) keep seeing the old form.
      const includeMode = mode != null && mode !== DEFAULT_USAGE_MODE
      const parts = [`@${item.characterSlug}:${nextIndex}`]
      if (variantSlug) parts.push(variantSlug)
      if (includeMode) parts.push(mode)
      tag = parts.join(":")
    }
    insertTag(tag)
  }, [insertTag, clearFilterTextInTextarea, triggerInfo, value, drillVariant])

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    if (maxLength && newValue.length > maxLength) return
    onChange(newValue)

    const cursor = e.target.selectionStart
    const charBefore = newValue[cursor - 1]

    const charBeforeTrigger = cursor >= 2 ? newValue[cursor - 2] : undefined
    const isSnippetTrigger =
      charBefore === "/"
      && tagMode === "none"
      && (snippets?.length ?? 0) > 0
      && (cursor === 1 || /\s/.test(charBeforeTrigger ?? ""))

    const isBraceTrigger = charBefore === "{" && nodeRefs && nodeRefs.length > 0
    const isBracketTrigger = (charBefore === "[" || charBefore === "/") && tagMode !== "none"
    const isSsmlTrigger = charBefore === "<" && tagMode === "audio"
    const isAtTrigger = charBefore === "@" && referenceImages && referenceImages.length > 0

    if (isBracketTrigger || isSsmlTrigger || isBraceTrigger || isAtTrigger || isSnippetTrigger) {
      const trigger = charBefore as TriggerChar
      setTriggerInfo({ char: trigger, position: cursor - 1 })
      setFilterText("")
      setSelectedIndex(0)
      setShowDropdown(true)
      setWarning(null)
      setDrillCharacterSlug(null)
      setDrillVariant(null)
      updateDropdownPos()
    } else if (showDropdown && triggerInfo) {
      // Update filter text
      const textSinceTrigger = newValue.slice(triggerInfo.position + 1, cursor)

      // Dismiss if user typed a closing bracket/brace or went before trigger.
      // "@" has no closing char — matches "{" behavior (dismiss via Escape or click-outside).
      const closingChars =
        triggerInfo.char === "{" ? "}"
        : triggerInfo.char === "<" ? ">"
        : triggerInfo.char === "@" ? null
        : "]"
      const hitClosing = closingChars !== null && textSinceTrigger.includes(closingChars)
      if (cursor <= triggerInfo.position || hitClosing) {
        dismiss()
      } else {
        setFilterText(textSinceTrigger)
        setSelectedIndex(0)
      }
    }
  }, [maxLength, onChange, showDropdown, triggerInfo, nodeRefs, referenceImages, tagMode, dismiss, updateDropdownPos, snippets])

  // Locate every {image:N} or {image:N:label} token in the current value so
  // navigation/deletion can treat each token as one atomic unit.
  const findImageTokens = useCallback((): Array<{ start: number; end: number }> => {
    const tokens: Array<{ start: number; end: number }> = []
    for (const m of value.matchAll(/\{image:\d+(?::[a-zA-Z0-9_-]+)?\}/gi)) {
      const start = m.index ?? 0
      tokens.push({ start, end: start + m[0].length })
    }
    return tokens
  }, [value])

  const removeTokenAt = useCallback((start: number, end: number) => {
    const newValue = value.slice(0, start) + value.slice(end)
    onChange(newValue)
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = start
        textareaRef.current.selectionEnd = start
        textareaRef.current.focus()
      }
    })
  }, [value, onChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Autocomplete dropdown navigation (only when dropdown is open)
    if (showDropdown && filtered.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIndex((i) => (i + 1) % filtered.length)
        return
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length)
        return
      } else if (e.key === "Enter") {
        e.preventDefault()
        const item = filtered[selectedIndex]
        if (item) selectSuggestion(item)
        return
      } else if (e.key === "Escape") {
        e.preventDefault()
        dismiss()
        return
      } else if (
        e.key === "ArrowRight"
        && triggerInfo?.char === "@"
        && drillCharacterSlug
        && !drillVariant
      ) {
        // In the variant view (level 2), Right on a variant row drills into
        // the mode picker. Anywhere else, fall through (lets cursor move).
        const item = filtered[selectedIndex]
        if (item?.kind === "variant" && item.characterSlug) {
          e.preventDefault()
          drillIntoMode(item)
          return
        }
      } else if (
        e.key === "ArrowLeft"
        && triggerInfo?.char === "@"
        && drillVariant
      ) {
        // In the mode picker (level 3), Left pops back to the variant view.
        e.preventDefault()
        setDrillVariant(null)
        setSelectedIndex(1)
        setFilterText("")
        clearFilterTextInTextarea()
        return
      } else if (
        e.key === "Backspace"
        && triggerInfo?.char === "@"
        && filterText.length === 0
      ) {
        // In drill-in views with empty filter, Backspace pops one level
        // (mode → variant → root) instead of deleting the `@` (which would
        // close the popup).
        if (drillVariant) {
          e.preventDefault()
          setDrillVariant(null)
          setSelectedIndex(1)
          return
        }
        if (drillCharacterSlug) {
          e.preventDefault()
          setDrillCharacterSlug(null)
          setSelectedIndex(0)
          return
        }
      }
    }

    // Atomic image-token navigation/deletion. Only act on simple cursor
    // movements (no selection, no modifier-key shortcuts).
    const ta = textareaRef.current
    if (!ta || ta.selectionStart !== ta.selectionEnd) return
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
    const cursor = ta.selectionStart
    const tokens = findImageTokens()

    if (e.key === "Backspace") {
      // Token immediately before cursor → delete whole token in one keystroke.
      const tok = tokens.find((t) => t.end === cursor)
      if (tok) {
        e.preventDefault()
        removeTokenAt(tok.start, tok.end)
      }
    } else if (e.key === "Delete") {
      // Token immediately after cursor → delete whole token.
      const tok = tokens.find((t) => t.start === cursor)
      if (tok) {
        e.preventDefault()
        removeTokenAt(tok.start, tok.end)
      }
    } else if (e.key === "ArrowLeft") {
      // Cursor at end of token → jump to start (skip over token contents).
      const tok = tokens.find((t) => t.end === cursor)
      if (tok) {
        e.preventDefault()
        ta.selectionStart = tok.start
        ta.selectionEnd = tok.start
      }
    } else if (e.key === "ArrowRight") {
      // Cursor at start of token → jump to end.
      const tok = tokens.find((t) => t.start === cursor)
      if (tok) {
        e.preventDefault()
        ta.selectionStart = tok.end
        ta.selectionEnd = tok.end
      }
    }
  }, [showDropdown, filtered, selectedIndex, selectSuggestion, dismiss, findImageTokens, removeTokenAt, triggerInfo, drillCharacterSlug, drillVariant, drillIntoMode, clearFilterTextInTextarea, filterText])

  // Snap cursor to nearest token boundary when a click lands inside a token.
  const handleSelect = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    if (ta.selectionStart !== ta.selectionEnd) return // user is selecting a range — leave it alone
    const cursor = ta.selectionStart
    const tokens = findImageTokens()
    const inside = tokens.find((t) => cursor > t.start && cursor < t.end)
    if (inside) {
      const snapTo = (cursor - inside.start) < (inside.end - cursor) ? inside.start : inside.end
      ta.selectionStart = snapTo
      ta.selectionEnd = snapTo
    }
  }, [findImageTokens])

  // Dismiss on outside click
  useEffect(() => {
    if (!showDropdown) return
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current?.contains(e.target as Node)) return
      if (textareaRef.current?.contains(e.target as Node)) return
      dismiss()
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [showDropdown, dismiss])

  // Hybrid mode orthogonality: when the user types a non-empty filter while
  // drilled into a character (but NOT in the mode picker — there typing
  // filters the modes themselves), reset the character drill so the
  // flat-search results aren't masked. Clearing the filter back to empty
  // resumes the hierarchical root view automatically (drill stays null).
  useEffect(() => {
    if (filterText.trim().length > 0 && drillCharacterSlug && !drillVariant) {
      setDrillCharacterSlug(null)
    }
  }, [filterText, drillCharacterSlug, drillVariant])

  // Clear transient insert-time warning after 4 seconds
  useEffect(() => {
    if (!warning) return
    const timer = setTimeout(() => setWarning(null), 4000)
    return () => clearTimeout(timer)
  }, [warning])

  // Scroll selected item into view
  useEffect(() => {
    if (!showDropdown || !dropdownRef.current) return
    const el = dropdownRef.current.querySelector(`[data-index="${selectedIndex}"]`)
    if (el) el.scrollIntoView({ block: "nearest" })
  }, [selectedIndex, showDropdown])

  const hasNodeRefs = nodeRefs && nodeRefs.length > 0
  const hasRefImages = referenceImages && referenceImages.length > 0
  const hasBraceTokens = hasNodeRefs || hasRefImages
  const highlightPattern = tagMode === "none"
    ? (hasBraceTokens ? NODE_REF_PATTERN : null)
    : (hasBraceTokens ? COMBINED_PATTERN : TAG_PATTERN)

  // Build highlighted backdrop content
  const highlightedContent = useMemo((): ReactNode[] => {
    if (!value) return []
    if (!highlightPattern) {
      const parts: ReactNode[] = [value]
      if (value.endsWith("\n")) parts.push("\n")
      return parts
    }
    const parts: ReactNode[] = []
    let lastIndex = 0
    const re = new RegExp(highlightPattern.source, "g")
    for (const match of value.matchAll(re)) {
      const matchIndex = match.index ?? 0
      if (matchIndex > lastIndex) {
        parts.push(value.slice(lastIndex, matchIndex))
      }
      const text = match[0]
      const imageRefMatch = text.match(/^\{image:(\d+)(?::([a-zA-Z0-9_-]+))?\}$/i)
      if (imageRefMatch && referenceImages) {
        const n = parseInt(imageRefMatch[1], 10)
        const labelPart = imageRefMatch[2] ?? ""
        const ref = n >= 1 ? referenceImages[n - 1] : undefined
        const tokenStart = matchIndex
        const tokenEnd = matchIndex + text.length
        parts.push(
          <span
            key={matchIndex}
            className="image-ref-pill"
          >
            {ref?.url && (
              <img
                src={optimizedImageUrl(ref.url, { width: 48, quality: 80 })}
                alt=""
                className="image-ref-pill__thumb"
                onMouseEnter={(e) =>
                  setImagePreview({ url: ref.url, anchor: e.currentTarget.getBoundingClientRect() })
                }
                onMouseLeave={() => setImagePreview(null)}
              />
            )}
            <span className="image-ref-pill__label">
              @image:{n}{labelPart && `:${labelPart}`}
            </span>
            <button
              type="button"
              aria-label="Remove image reference"
              className="image-ref-pill__remove"
              onMouseDown={(e) => {
                // Use mousedown so the textarea doesn't reclaim focus before
                // we can read its selection / call onChange.
                e.preventDefault()
                removeTokenAt(tokenStart, tokenEnd)
              }}
            >
              ×
            </button>
          </span>,
        )
      } else {
        const isNodeRef = text.startsWith("{")
        parts.push(
          <mark key={matchIndex} className={isNodeRef ? "node-ref-highlight" : "tag-highlight"}>{text}</mark>,
        )
      }
      lastIndex = matchIndex + text.length
    }
    if (lastIndex < value.length) {
      parts.push(value.slice(lastIndex))
    }
    // Trailing newline: browsers collapse it in the div, add extra to keep scroll height in sync
    if (value.endsWith("\n")) {
      parts.push("\n")
    }
    return parts
  }, [value, highlightPattern, referenceImages, removeTokenAt])

  // Sync scroll from textarea to backdrop
  const backdropRef = useRef<HTMLDivElement | null>(null)
  const handleScroll = useCallback(() => {
    if (textareaRef.current && backdropRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop
      backdropRef.current.scrollLeft = textareaRef.current.scrollLeft
    }
  }, [])

  const renderFormattedText = useMemo(() => {
    if (displayMode === "raw" || !refMap) return null
    return renderNodeRefs(value || "", refMap, displayMode)
  }, [displayMode, refMap, value])

  const dropdown = showDropdown && filtered.length > 0 && dropdownPos && createPortal(
    <div
      ref={dropdownRef}
      style={{
        position: "fixed",
        top: dropdownPos.top,
        left: dropdownPos.left,
        minWidth: Math.max(dropdownPos.width, 200),
        maxHeight: dropdownPos.maxHeight,
      }}
      className="z-[9999] overflow-y-auto rounded-lg border border-border bg-popover shadow-lg py-1"
    >
      {Array.from(groupedFiltered.entries()).map(([category, items]) => (
        <div key={category}>
          <div className="sticky top-0 bg-muted/80 backdrop-blur-sm px-2.5 py-1 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/50">
            {category}
          </div>
          {items.map((item) => {
            const idx = filtered.indexOf(item)
            const isSelected = idx === selectedIndex
            const isBack = item.kind === "back"
            const isMode = item.kind === "mode"
            const isCharacterRoot = item.kind === "character-root"
            const isVariant = item.kind === "variant"
            const isRefImage = !isBack && !isMode && item.thumbnailUrl !== undefined
            const isSnippet = item.snippetText !== undefined
            const isNodeRef = !isBack && !isMode && !isRefImage && !isSnippet && category !== "Audio Tags" && category !== "Suno"
            // Render the mode-picker chip on character variant rows when in
            // the level-2 drill view. The chip is a separate click target
            // that drills one more level into the mode picker (instead of
            // inserting with the default mode like an Enter on the row).
            // Flat-search variants skip the chip — drilling from a search
            // result is confusing (the user already filtered to a variant;
            // mode is a separate concern best set after picking).
            const showModeChip = isVariant
              && triggerInfo?.char === "@"
              && drillCharacterSlug != null
              && drillVariant == null
              && item.characterSlug != null

            // "Back" row: arrow + label, no thumbnail, no tag pill.
            if (isBack) {
              return (
                <button
                  key={`back-${idx}`}
                  type="button"
                  data-index={idx}
                  className={`w-full text-left px-2.5 py-1.5 text-[11px] cursor-pointer transition-colors flex items-center gap-2 border-b border-border/50 ${
                    isSelected
                      ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
                      : "hover:bg-muted text-muted-foreground"
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    selectSuggestion(item)
                  }}
                >
                  <span className="font-medium">&larr; {item.label}</span>
                </button>
              )
            }

            // "Mode" row (level-3 drill): label + `:mode` chip, no thumbnail.
            if (isMode) {
              return (
                <button
                  key={`mode-${item.mode}`}
                  type="button"
                  data-index={idx}
                  className={`w-full text-left px-2.5 py-1.5 text-[11px] cursor-pointer transition-colors flex items-center gap-2 ${
                    isSelected
                      ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
                      : "hover:bg-muted text-foreground"
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    selectSuggestion(item)
                  }}
                >
                  <span className="truncate flex-1 min-w-0">{item.label}</span>
                  <span
                    className={`inline-flex items-center rounded-md border px-1.5 py-0 text-[10px] font-mono font-medium leading-4 shrink-0 ${
                      isSelected
                        ? "border-sky-400/60 bg-sky-500/20 text-sky-700 dark:text-sky-200"
                        : "border-sky-400/40 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                    }`}
                  >
                    {item.tag}
                  </span>
                </button>
              )
            }

            return (
              <button
                key={isSnippet ? `snippet-${item.snippetId}` : item.tag}
                type="button"
                data-index={idx}
                className={`w-full text-left px-2.5 py-1.5 text-[11px] cursor-pointer transition-colors flex items-center gap-2 ${
                  isSelected
                    ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
                    : "hover:bg-muted text-foreground"
                }`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  selectSuggestion(item)
                }}
              >
                {isRefImage && (
                  <>
                    <img
                      src={optimizedImageUrl(item.thumbnailUrl, { width: 64, quality: 80 })}
                      alt=""
                      className="w-7 h-7 rounded object-cover shrink-0 border border-border/40"
                      loading="lazy"
                    />
                    <span className="truncate flex-1 min-w-0">
                      {item.label}
                      {item.variantDisplayName && item.variantDisplayName !== "canonical" && (
                        <span className="text-slate-500 ml-1">/ {item.variantDisplayName}</span>
                      )}
                    </span>
                    {isCharacterRoot ? (
                      // Drill-in hint — no tag pill (clicking drills, doesn't insert).
                      <span
                        className="text-slate-500 text-[12px] leading-4 shrink-0"
                        aria-hidden
                      >
                        &rsaquo;
                      </span>
                    ) : (
                      <>
                        <span
                          className={`inline-flex items-center rounded-md border px-1.5 py-0 text-[10px] font-mono font-medium leading-4 shrink-0 ${
                            isSelected
                              ? "border-sky-400/60 bg-sky-500/20 text-sky-700 dark:text-sky-200"
                              : "border-sky-400/40 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                          }`}
                        >
                          {item.tag}
                        </span>
                        {showModeChip && (
                          <span
                            role="button"
                            aria-label="Pick usage mode"
                            title="Pick usage mode (or press Right arrow)"
                            className={`inline-flex items-center rounded-md border px-1.5 py-0 text-[10px] font-medium leading-4 shrink-0 cursor-pointer transition-colors ${
                              isSelected
                                ? "border-sky-400/60 bg-sky-500/10 text-sky-700 dark:text-sky-200 hover:bg-sky-500/25"
                                : "border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground"
                            }`}
                            onMouseDown={(e) => {
                              // Stop the row's onMouseDown from also firing
                              // (which would insert with the default mode
                              // instead of drilling into the mode picker).
                              e.preventDefault()
                              e.stopPropagation()
                              drillIntoMode(item)
                            }}
                          >
                            mode &rsaquo;
                          </span>
                        )}
                      </>
                    )}
                  </>
                )}
                {isSnippet && (
                  // Snippet row: stacked name (primary) + truncated text preview
                  // (secondary), mirroring the PromptEditor's SnippetSuggestionList.
                  <span className="flex-1 min-w-0">
                    <span className="block text-[11px] font-medium truncate">{item.label}</span>
                    <span className="block text-[10px] text-muted-foreground truncate">{item.tag}</span>
                  </span>
                )}
                {isNodeRef && (
                  <span
                    className={`inline-flex items-center rounded-md border px-1.5 py-0 text-[10px] font-mono font-medium leading-4 ${
                      isSelected
                        ? "border-sky-400/60 bg-sky-500/20 text-sky-700 dark:text-sky-200"
                        : "border-sky-400/40 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                    }`}
                  >
                    {item.tag}
                  </span>
                )}
                {!isNodeRef && !isRefImage && !isSnippet && (
                  <span className="font-mono text-[11px]">{item.tag}</span>
                )}
              </button>
            )
          })}
        </div>
      ))}
    </div>,
    document.body,
  )

  return (
    <div ref={wrapperRef} className="relative">
      {displayMode !== "raw" && renderFormattedText ? (
        <div
          className="rounded-md border border-border bg-muted/30 p-3 text-sm text-foreground whitespace-pre-wrap leading-relaxed"
          style={{ minHeight: rows ? `${rows * 1.5}rem` : undefined }}
          role="textbox"
          aria-readonly="true"
        >
          {renderFormattedText}
        </div>
      ) : (
        <>
          <div className="tag-textarea-container">
            <div
              ref={backdropRef}
              aria-hidden
              className="tag-textarea-backdrop"
            >
              {highlightedContent}
            </div>
            <Textarea
              ref={textareaRef}
              rows={rows}
              value={value}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onScroll={handleScroll}
              onSelect={handleSelect}
              placeholder={placeholder}
              className={`tag-textarea-input ${className ?? ""}`}
            />
          </div>
          {dropdown}
        </>
      )}
      {warning && (
        <p className="text-[10px] text-amber-500 mt-1">{warning}</p>
      )}
      {imagePreview && createPortal(
        (() => {
          const { url, anchor } = imagePreview
          const PREVIEW_MAX = 220
          const MARGIN = 8
          const vh = window.innerHeight
          const vw = window.innerWidth
          // Prefer below the thumbnail; flip above if there's more headroom.
          const spaceBelow = vh - anchor.bottom - MARGIN
          const spaceAbove = anchor.top - MARGIN
          const placeBelow = spaceBelow >= PREVIEW_MAX || spaceBelow >= spaceAbove
          const top = placeBelow
            ? anchor.bottom + MARGIN
            : Math.max(MARGIN, anchor.top - PREVIEW_MAX - MARGIN)
          // Keep within viewport horizontally; align left edge to the thumbnail.
          const left = Math.min(Math.max(MARGIN, anchor.left), vw - PREVIEW_MAX - MARGIN)
          return (
            <div
              style={{ position: "fixed", top, left }}
              className="z-[10000] pointer-events-none rounded-md shadow-xl bg-popover border border-border p-1"
              aria-hidden
            >
              <img
                src={optimizedImageUrl(url, { width: 480 })}
                alt=""
                className="block rounded object-contain"
                style={{ maxWidth: PREVIEW_MAX, maxHeight: PREVIEW_MAX }}
              />
            </div>
          )
        })(),
        document.body,
      )}
    </div>
  )
}
