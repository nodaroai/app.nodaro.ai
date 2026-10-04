"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useT } from "@/lib/i18n"
import {
  CONTENT_IDEAS_BRAND_MAX,
  CONTENT_IDEAS_DEFAULT_COUNT,
  CONTENT_IDEAS_LANGUAGE_MAX,
  CONTENT_IDEAS_MAX_COUNT,
  CONTENT_IDEAS_PER_CHARGE,
  clampContentIdeasCount,
} from "@nodaro/shared"
import { LlmModelSelect } from "./llm-model-select"
import { MappableField } from "./mappable-field"
import type { ConfigProps } from "./types"
import type { ContentIdeasNodeData, ContentRecipeNodeData } from "@/types/nodes"

/**
 * Settings for the "steal the format" nodes. Both are text-only structured
 * calls, so the model picker offers every model that can return
 * schema-shaped output (the cloud route refuses the rest).
 */
const STRUCTURED_MODEL = (m: { structuredOutputMode?: unknown }) => m.structuredOutputMode != null

export function ContentRecipeConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<ContentRecipeNodeData>) {
  const t = useT()
  // The `link` wire wins over the typed link at run time — show which.
  const wiredLink = sources.find((s) => s.targetHandle === "link")
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-muted-foreground">{t("cfgext.contentRecipeHint")}</p>

      <LlmModelSelect
        feature="content-recipe"
        value={data.llmModel}
        onChange={(v) => onUpdate({ llmModel: v })}
        filter={STRUCTURED_MODEL}
      />

      <MappableField field="focus" label={t("cfgext.contentRecipeFocus")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea
          value={data.focus ?? ""}
          placeholder={t("cfgext.contentRecipeFocusPlaceholder")}
          rows={2}
          maxLength={2000}
          onChange={(e) => onUpdate({ focus: e.target.value })}
        />
      </MappableField>

      <div>
        <Label htmlFor="content-recipe-source-url">{t("cfgext.contentRecipeSourceUrl")}</Label>
        {wiredLink ? (
          <p className="text-[11px] text-muted-foreground">{t("cfgext.contentRecipeSourceUrlWired", { label: wiredLink.label })}</p>
        ) : (
          <Input
            id="content-recipe-source-url"
            dir="ltr"
            type="url"
            value={data.sourceUrl ?? ""}
            placeholder={t("cfgext.contentRecipeSourceUrlPlaceholder")}
            onChange={(e) => onUpdate({ sourceUrl: e.target.value })}
          />
        )}
      </div>
    </div>
  )
}

export function ContentIdeasConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<ContentIdeasNodeData>) {
  const t = useT()
  const count = clampContentIdeasCount(data.count ?? CONTENT_IDEAS_DEFAULT_COUNT)
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-muted-foreground">{t("cfgext.contentIdeasHint")}</p>

      <LlmModelSelect
        feature="content-ideas"
        value={data.llmModel}
        onChange={(v) => onUpdate({ llmModel: v })}
        filter={STRUCTURED_MODEL}
      />

      <MappableField
        field="brand"
        label={t("cfgext.contentIdeasBrand")}
        sources={sources}
        fieldMappings={fieldMappings}
        onMapField={onMapField}
        wiredHandleId="field-brand"
      >
        <Textarea
          dir="auto"
          value={data.brand ?? ""}
          placeholder={t("cfgext.contentIdeasBrandPlaceholder")}
          rows={5}
          maxLength={CONTENT_IDEAS_BRAND_MAX}
          onChange={(e) => onUpdate({ brand: e.target.value })}
        />
      </MappableField>

      <div>
        <Label htmlFor="content-ideas-count">{t("cfgext.contentIdeasCount")}</Label>
        <Input
          id="content-ideas-count"
          type="number"
          min={1}
          max={CONTENT_IDEAS_MAX_COUNT}
          value={count}
          onChange={(e) => onUpdate({ count: clampContentIdeasCount(e.target.value === "" ? undefined : Number(e.target.value)) })}
        />
        <p className="text-[11px] text-muted-foreground mt-1">
          {t("cfgext.contentIdeasCountHint", { perCharge: CONTENT_IDEAS_PER_CHARGE })}
        </p>
      </div>

      <MappableField field="language" label={t("cfgext.contentIdeasLanguage")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input
          value={data.language ?? ""}
          placeholder={t("cfgext.contentIdeasLanguagePlaceholder")}
          maxLength={CONTENT_IDEAS_LANGUAGE_MAX}
          onChange={(e) => onUpdate({ language: e.target.value })}
        />
      </MappableField>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="content-ideas-brand-lessons">{t("cfgext.contentIdeasBrandLessons")}</Label>
          <Switch
            id="content-ideas-brand-lessons"
            checked={data.useBrandLessons !== false}
            // `undefined` when on (the default), so a node that never touched
            // this stays byte-identical to one saved before the switch existed.
            onCheckedChange={(v) => onUpdate({ useBrandLessons: v ? undefined : false })}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">{t("cfgext.contentIdeasBrandLessonsHint")}</p>
      </div>
    </div>
  )
}
