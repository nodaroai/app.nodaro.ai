"use client"

import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { LlmModelSelect } from "./llm-model-select"
import { useT, tx } from "@/lib/i18n"

/**
 * Per-strategy config form for the Choose Best node (type id `reduce`).
 *
 * Strategy ids are declared in `@nodaro/shared/reduce-strategy-registry`.
 * Each branch here mirrors a strategy's `configSchema` field-by-field. When
 * the registry adds a new strategy or field, this switch is the local point
 * of change — the dispatching `ReduceConfig` stays untouched.
 */
/**
 * "The candidates are" — what the AI judge is handed. ONE list for the side
 * panel and the node's head-row chip (reduce-node.tsx), so the two cannot
 * drift. Values are the registry's `inputKind` enum. The description matters:
 * with image candidates left on Texts the judge compares the URL strings,
 * not the pictures — a meaningless pick that looks like a real one.
 *
 * A FUNCTION, not a module constant: the copy is localized, and a constant
 * would freeze whatever locale happened to be active at module load.
 */
export function REDUCE_INPUT_KIND_OPTIONS(): readonly {
  readonly value: ReduceInputKind
  readonly label: string
  readonly description: string
}[] {
  return [
    { value: "text", label: tx("cfgext.reduceFormTexts"), description: tx("cfgext.reduceFormTextsDesc") },
    { value: "image-url", label: tx("assetlib.tabImages"), description: tx("cfgext.reduceFormImagesDesc") },
  ]
}

export type ReduceInputKind = "text" | "image-url"

export const reduceInputKindLabel = (kind: string): string => {
  const options = REDUCE_INPUT_KIND_OPTIONS()
  return options.find((o) => o.value === kind)?.label ?? options[0].label
}

type Props = {
  readonly strategyId: string
  readonly config: Record<string, unknown>
  readonly onChange: (cfg: Record<string, unknown>) => void
}

export function ReduceStrategyForms({ strategyId, config, onChange }: Props) {
  const t = useT()
  switch (strategyId) {
    case "pick-best-llm":
      return (
        <div className="flex flex-col gap-3">
          {/* The judge model — same selector every LLM node uses (tier badges,
              descriptions). Its tier drives the credit price: economy /
              standard / premium. Stored on strategyConfig.llmModel so the
              route, the estimator and the SDK all read one field. */}
          <LlmModelSelect
            feature="pick-best-llm"
            value={typeof config.llmModel === "string" ? config.llmModel : undefined}
            onChange={(llmModel) => onChange({ ...config, llmModel })}
          />
          <div className="flex flex-col gap-1.5">
            <Label>{t("cfgext.reduceFormJudgeBy")}</Label>
            <Textarea
              value={String(config.criteria ?? "")}
              onChange={(e) => onChange({ ...config, criteria: e.target.value })}
              placeholder={t("cfgext.reduceFormCriteriaPlaceholder")}
              rows={3}
            />
            <p className="text-[10px] text-muted-foreground">
              {t("cfgext.reduceFormCriteriaHint")}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t("cfgext.reduceFormCandidatesAre")}</Label>
            <Select
              value={String(config.inputKind ?? "text")}
              onValueChange={(v) => onChange({ ...config, inputKind: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REDUCE_INPUT_KIND_OPTIONS().map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    <span className="flex flex-col gap-0.5">
                      <span>{o.label}</span>
                      <span className="text-[10px] leading-tight text-muted-foreground/70">{o.description}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              {t("cfgext.reduceFormKindHint")}
            </p>
          </div>
        </div>
      )

    case "concat":
      return (
        <div className="flex flex-col gap-1.5">
          <Label>{t("utilcfg.separator")}</Label>
          <Input
            value={String(config.separator ?? "\n\n")}
            onChange={(e) => onChange({ ...config, separator: e.target.value })}
            placeholder={t("cfgext.reduceFormSeparatorPlaceholder")}
          />
          <p className="text-[10px] text-muted-foreground">
            {t("cfgext.reduceFormSeparatorHint")}
          </p>
        </div>
      )

    case "vote":
      return (
        <div className="flex items-center gap-2">
          <Switch
            checked={Boolean(config.caseSensitive)}
            onCheckedChange={(v) => onChange({ ...config, caseSensitive: v })}
          />
          <Label className="cursor-pointer">{t("cfgext.reduceFormCaseSensitive")}</Label>
        </div>
      )

    case "merge-json":
      return (
        <div className="flex flex-col gap-1.5">
          <Label>{t("cfgext.reduceFormHowToMerge")}</Label>
          <Select
            value={String(config.strategy ?? "deep")}
            onValueChange={(v) => onChange({ ...config, strategy: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="deep">{t("cfgext.reduceFormDeep")}</SelectItem>
              <SelectItem value="shallow">{t("cfgext.reduceFormShallow")}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground">
            {t("cfgext.reduceFormMergeHint")}
          </p>
        </div>
      )

    case "first-non-empty":
    case "count":
      return (
        <p className="text-xs text-muted-foreground">{t("cfgext.reduceFormNothingToConfigure")}</p>
      )

    default:
      return null
  }
}
