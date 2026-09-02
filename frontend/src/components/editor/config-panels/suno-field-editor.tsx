import { tx } from "@/lib/i18n"
import { Input } from "@/components/ui/input"
import { TagTextarea, type SuggestionItem } from "./tag-textarea"
import { PromptLengthCounter } from "./prompt-length-counter"
import { SUNO_LYRICS_SUGGESTION_ITEMS, SUNO_STYLE_SUGGESTION_ITEMS } from "@/lib/suno-tags"
import { getMaxSunoStyleChars, getMaxSunoPromptChars, SUNO_TEXT_MAX } from "@nodaro/shared"
import { getEffectiveSunoCustomMode } from "@nodaro/prompts"
import type { SunoGenerateData } from "@/types/nodes"

/**
 * Single source of truth for the four Suno "secondary" text fields. The config
 * panel (Suno Generate), the Phase C field-edit modal, and the on-node quick
 * menu all render these from THIS descriptor — caps/kind/rows/counter live here,
 * never hardcoded in the component, so the same editor recurs for suno-cover /
 * suno-extend with their own caps by passing a different `SunoFieldEditMeta`.
 */
export type SunoEditField = "style" | "lyrics" | "title" | "negativeStyle"

export interface SunoFieldEditMeta {
  readonly field: SunoEditField
  readonly label: string
  /** The label without its "(optional)" tail — for the on-node quick menu. */
  readonly shortLabel: string
  readonly kind: "input" | "tags"
  readonly rows?: number
  readonly maxLength: number
  readonly customTags?: ReadonlyArray<SuggestionItem>
  readonly placeholder: string
  readonly counter?: "style" | "prompt"
}

// A getter, not a module constant: the labels/placeholders are chrome copy and
// must follow a live language switch instead of freezing on the boot locale.
export function SUNO_FIELD_EDIT_META(): Record<SunoEditField, SunoFieldEditMeta> {
  return {
    title: { field: "title", label: tx("audiocfg.titleOptional"), shortLabel: tx("audiocfg.fieldTitle"), kind: "input", maxLength: 200, placeholder: tx("audiocfg.phSongTitle") },
    lyrics: { field: "lyrics", label: tx("audiocfg.lyricsOptional"), shortLabel: tx("audiocfg.fieldLyrics"), kind: "tags", rows: 4, maxLength: SUNO_TEXT_MAX, customTags: SUNO_LYRICS_SUGGESTION_ITEMS, placeholder: tx("audiocfg.phWriteCustomLyricsTags"), counter: "prompt" },
    style: { field: "style", label: tx("audiocfg.styleOptional"), shortLabel: tx("audiocfg.fieldStyle"), kind: "tags", rows: 2, maxLength: 1000, customTags: SUNO_STYLE_SUGGESTION_ITEMS, placeholder: tx("audiocfg.phGenreTags1"), counter: "style" },
    negativeStyle: { field: "negativeStyle", label: tx("audiocfg.negativeStyleOptional"), shortLabel: tx("audiocfg.fieldNegativeStyle"), kind: "tags", rows: 2, maxLength: 500, customTags: SUNO_STYLE_SUGGESTION_ITEMS, placeholder: tx("audiocfg.phStylesToAvoidTags") },
  }
}

export function SunoFieldEditor({
  meta, data, onUpdate, nodeRefs, refMap, variableDisplayMode,
}: {
  readonly meta: SunoFieldEditMeta
  readonly data: SunoGenerateData
  readonly onUpdate: (patch: Partial<SunoGenerateData>) => void
  // Inferred straight from TagTextarea's own prop types (single source of truth):
  // VariableDisplayMode isn't re-exported from ./tag-textarea, and the config
  // panel's variableDisplayMode is optional — inferring keeps both callers valid.
  readonly nodeRefs: Parameters<typeof TagTextarea>[0]["nodeRefs"]
  readonly refMap: Parameters<typeof TagTextarea>[0]["refMap"]
  readonly variableDisplayMode: Parameters<typeof TagTextarea>[0]["displayMode"]
}) {
  const value = (data[meta.field] as string | undefined) ?? ""
  const write = (v: string) => { if (v.length <= meta.maxLength) onUpdate({ [meta.field]: v } as Partial<SunoGenerateData>) }

  if (meta.kind === "input") {
    return <Input value={value} maxLength={meta.maxLength} onChange={(e) => write(e.target.value)} placeholder={meta.placeholder} />
  }
  return (
    <>
      <TagTextarea
        rows={meta.rows} value={value} onChange={write} placeholder={meta.placeholder} maxLength={meta.maxLength}
        tagMode="suno" customTags={meta.customTags ?? []} nodeRefs={nodeRefs} displayMode={variableDisplayMode} refMap={refMap}
      />
      {meta.counter === "style" && (
        <PromptLengthCounter value={value} max={getMaxSunoStyleChars(data.model)} modelLabel={data.model ?? "V5_5"} noun="style" />
      )}
      {meta.counter === "prompt" && (
        <PromptLengthCounter value={value} max={getMaxSunoPromptChars(data.model, getEffectiveSunoCustomMode(data))} modelLabel={data.model ?? "V5_5"} noun="lyrics" />
      )}
    </>
  )
}
