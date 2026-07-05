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
  readonly kind: "input" | "tags"
  readonly rows?: number
  readonly maxLength: number
  readonly customTags?: ReadonlyArray<SuggestionItem>
  readonly placeholder: string
  readonly counter?: "style" | "prompt"
}

export const SUNO_FIELD_EDIT_META: Record<SunoEditField, SunoFieldEditMeta> = {
  title: { field: "title", label: "Title (optional)", kind: "input", maxLength: 200, placeholder: "Song title" },
  lyrics: { field: "lyrics", label: "Lyrics (optional)", kind: "tags", rows: 4, maxLength: SUNO_TEXT_MAX, customTags: SUNO_LYRICS_SUGGESTION_ITEMS, placeholder: "Write custom lyrics... (type [ or / for metatags)", counter: "prompt" },
  style: { field: "style", label: "Style (optional)", kind: "tags", rows: 2, maxLength: 1000, customTags: SUNO_STYLE_SUGGESTION_ITEMS, placeholder: "e.g. pop, rock, jazz, lo-fi... (type [ or / for suggestions)", counter: "style" },
  negativeStyle: { field: "negativeStyle", label: "Negative Style (optional)", kind: "tags", rows: 2, maxLength: 500, customTags: SUNO_STYLE_SUGGESTION_ITEMS, placeholder: "Styles to avoid... (type [ or / for suggestions)" },
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
