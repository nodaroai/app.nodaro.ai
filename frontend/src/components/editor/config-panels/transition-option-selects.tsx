"use client"

import { getTransitionLabel, getTransitionOptions, type TransitionOptionChoice } from "@nodaro/prompts"
import { pickIds } from "@nodaro/shared"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"
import { useT, type TFunction } from "@/lib/i18n"
import { useLocalizeOptionLabel } from "@/lib/i18n/labels"
import type { TransitionData } from "@/types/nodes"
import type { ConfigProps } from "./types"

/**
 * A choice as the panel shows it. `row` is set on a choice merged in from a
 * later pick's row, which the panel names after that row; `sharedDefault`
 * marks the one `auto` entry of a merged field, which stands for every row's
 * own default look.
 */
interface ShownChoice extends TransitionOptionChoice {
  readonly row?: string
  readonly sharedDefault?: boolean
}

interface ShownOption {
  readonly field: string
  readonly label: string
  readonly choices: ReadonlyArray<ShownChoice>
}

/**
 * The per-row options of every picked transition (a wipe's direction, a row's
 * Style), each FIELD once, in pick order — see `Transition.options`.
 *
 * A field is one node-data key, so a two-pick of two rows that both declare it
 * (two styled rows) gets ONE control: its rows are the first row's, then the
 * second's own choices named after their row ("Garden Bloom · Hedge doors"),
 * and the shared `auto` entry reads "Default look" (it is each row's default).
 * Choice ids carry their row's id, so the one stored value styles the row it
 * belongs to and the other row keeps its default look.
 */
export function transitionOptionsFor(value: string | string[] | undefined): ReadonlyArray<ShownOption> {
  const byField = new Map<string, ShownOption>()
  for (const id of pickIds(value)) {
    for (const option of getTransitionOptions(id)) {
      const seen = byField.get(option.field)
      if (!seen) {
        byField.set(option.field, option)
        continue
      }
      const known = new Set(seen.choices.map((c) => c.id))
      const extra = option.choices.filter((c) => !known.has(c.id)).map((c) => ({ ...c, row: id }))
      const choices = seen.choices.map((c) => (c.id === "auto" ? { ...c, sharedDefault: true } : c))
      byField.set(option.field, { ...seen, choices: [...choices, ...extra] })
    }
  }
  return [...byField.values()]
}

/**
 * The catalog writes every option name, choice and tooltip in English. They are
 * data, so they translate through the option-label tables (`labels.<locale>.ts`)
 * by their English string; a choice merged in from another row is named after
 * its row in the transitions catalog's own language.
 */
function shownChoiceCopy(
  choice: ShownChoice,
  t: TFunction,
  localizeOption: (english: string) => string,
  rowLabel: (id: string) => string,
): { readonly label: string; readonly description: string } {
  if (choice.sharedDefault) {
    return { label: t("paramcfg.transitionDefaultLook"), description: t("paramcfg.transitionDefaultLookHint") }
  }
  const label = localizeOption(choice.label)
  return {
    label: choice.row ? t("common.scopedLabel", { scope: rowLabel(choice.row), label }) : label,
    description: localizeOption(choice.description),
  }
}

/**
 * The picked rows' OWN options (a wipe's direction, a styled row's look) —
 * declared by the catalog row, so a control appears only beside a transition
 * it changes. `auto` stores nothing.
 */
export function TransitionOptionSelects({ data, onUpdate }: Pick<ConfigProps<TransitionData>, "data" | "onUpdate">) {
  const t = useT()
  const localizeOption = useLocalizeOptionLabel()
  const { resolveLabel } = useLocalizedCatalog("transitions")
  const rowLabel = (id: string) => resolveLabel(id, getTransitionLabel(id))

  return (
    <>
      {transitionOptionsFor(data.transition).map((option) => {
        const label = localizeOption(option.label)
        const stored = data[option.field]
        return (
          <div key={option.field} className="flex flex-col gap-1">
            <Label className="text-[10px] uppercase">{label}</Label>
            <Select
              value={typeof stored === "string" && stored ? stored : "auto"}
              onValueChange={(v) => onUpdate({ [option.field]: v === "auto" ? undefined : v })}
            >
              <SelectTrigger className="h-8 text-xs" aria-label={label}><SelectValue /></SelectTrigger>
              <SelectContent>
                {option.choices.map((choice) => {
                  const copy = shownChoiceCopy(choice, t, localizeOption, rowLabel)
                  return (
                    <SelectItem key={choice.id} value={choice.id} title={copy.description}>
                      {copy.label}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>
        )
      })}
    </>
  )
}
