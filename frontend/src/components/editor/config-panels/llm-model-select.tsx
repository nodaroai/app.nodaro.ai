"use client"

import { useT, tx } from "@/lib/i18n"
import { useLocalizeModelDescription } from "@/lib/i18n/labels"
import { useMemo, useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { LLM_MODELS, LLM_FEATURE_DEFAULTS, LLM_VENDOR_LABELS, groupLlmModelsByVendor } from "@nodaro/shared"
import type { LlmTier, LlmFeature, LlmModelDef } from "@nodaro/shared"
import { modelMatchesQuery } from "@/lib/model-search"
import { ModelDescriptionHint } from "./model-description-hint"

export function TIER_LABELS(): Record<LlmTier, string> {
  return {
  economy: tx("cfgshared.tierEconomy"),
  standard: tx("cfgshared.tierStandard"),
  premium: tx("cfgshared.tierPremium"),
}
}

/** Tier badge colors — the frontend-wide convention (economy green, standard
 *  blue, premium amber) so the tier reads at a glance inside the long list. */
const TIER_BADGE_CLASSES: Record<LlmTier, string> = {
  economy: "text-emerald-600 dark:text-emerald-400",
  standard: "text-sky-600 dark:text-sky-400",
  premium: "text-amber-600 dark:text-amber-400",
}

/** One lowercased haystack per model for token-AND search — name, id, desc,
 *  vendor (label + raw id, so both "xAI" and "xai" hit), and tier. */
function llmModelHaystack(m: LlmModelDef): string {
  return `${m.id} ${m.displayName} ${m.desc} ${LLM_VENDOR_LABELS[m.vendor]} ${m.vendor} ${m.tier}`.toLowerCase()
}

interface LlmModelSelectProps {
  feature: LlmFeature
  value?: string
  onChange: (modelId: string) => void
  /** Optional predicate to restrict the offered models (default: all models).
   *  e.g. describe-to-picker restricts to STRUCTURED_VISION_MODELS because its
   *  analyzer needs guaranteed schema-shaped output over an image. */
  filter?: (model: LlmModelDef) => boolean
}

/**
 * The LLM model picker every LLM config panel renders. A searchable combobox
 * (Popover + cmdk, same pattern as ModelSearchSelect) grouped by vendor and
 * tier-ordered inside each group via the shared {@link groupLlmModelsByVendor}
 * — the flat registry-order dump this replaced was genuinely hard to scan at
 * 17 models. Props are unchanged from the old flat Select on purpose: the six
 * consumer panels didn't have to move.
 */
export function LlmModelSelect({ feature, value, onChange, filter }: LlmModelSelectProps) {
  const t = useT()
  const localizeDesc = useLocalizeModelDescription()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")

  const defaultModel = LLM_FEATURE_DEFAULTS[feature]
  const currentValue = value || defaultModel
  const models = filter ? LLM_MODELS.filter(filter) : LLM_MODELS
  const current = models.find((m) => m.id === currentValue) ?? LLM_MODELS.find((m) => m.id === currentValue)

  const groups = useMemo(() => {
    const q = query.trim()
    const visible = q ? models.filter((m) => modelMatchesQuery(llmModelHaystack(m), q)) : models
    return groupLlmModelsByVendor(visible)
  }, [models, query])

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setQuery("")
  }

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{t("cfgshared.aiModel")}</label>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={t("cfgshared.aiModel")}
            className="h-8 w-full justify-between px-2 text-xs font-normal"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{current?.displayName ?? currentValue}</span>
              {current && (
                <span className={cn("shrink-0 text-[10px]", TIER_BADGE_CLASSES[current.tier])}>
                  {TIER_LABELS()[current.tier]}
                </span>
              )}
            </span>
            <ChevronsUpDown className="ms-1 size-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        {/* z-[9999]: this picker also mounts inside dialogs (prompt helper,
            app-runner node config) — the stock z-50 can land under them. */}
        <PopoverContent align="start" className="z-[9999] w-[320px] p-0">
          <Command shouldFilter={false} className="bg-transparent">
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder={t("cfgshared.searchModelsTierPlaceholder")}
              className="placeholder:text-muted-foreground/50"
            />
            <CommandList>
              {groups.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">{t("cfgshared.noModelsMatch")}</div>
              ) : (
                groups.map((group) => (
                  <CommandGroup key={group.vendor} heading={group.label}>
                    {group.models.map((model) => (
                      <CommandItem
                        key={model.id}
                        value={model.id}
                        onSelect={() => {
                          onChange(model.id)
                          handleOpenChange(false)
                        }}
                        className="flex-col items-start gap-0.5 py-2 text-xs"
                      >
                        <span className="flex w-full items-center gap-2">
                          <Check className={cn("size-3.5 shrink-0", model.id === currentValue ? "opacity-100" : "opacity-0")} />
                          <span className="truncate">{model.displayName}</span>
                          <span className={cn("ms-auto shrink-0 text-[10px]", TIER_BADGE_CLASSES[model.tier])}>
                            {TIER_LABELS()[model.tier]}
                          </span>
                        </span>
                        <span className="ps-[1.375rem] text-[11px] leading-tight text-muted-foreground/60">
                          {localizeDesc(model.desc)}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <ModelDescriptionHint modelId={currentValue} />
    </div>
  )
}
