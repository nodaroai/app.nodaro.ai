// The reference sheets' rules (`SheetRules`): per kind (person, pet, product,
// location), which layout a role's sheet uses for what its photos cover, as
// the labeller reads them (head + body, body only, head only, unclear).
//
// Each row's select lists the kind's layouts in the design's numbering
// ("1 Collage (no AI)", "2 Head + body", …), then "None (raw photos)": the
// photos are sent as they are, with no sheet and no charge. "Reset to
// default" puts the kind's rows back to the engine's defaults. A row opens to
// show its layout's prompt, read-only (the engine's, read at run time); the
// collage and "none" use no AI, so they have none.
//
// The tables scroll inside their own box on a narrow screen.

import { Fragment, useId, useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAppDir } from "@/lib/locale-store"
import { SHEET_CONDITIONS, SHEET_KINDS, SHEET_LAYOUTS, type CastSwapStepsProblem, type SheetCondition, type SheetKind, type SheetLayout, type SheetRules } from "@/lib/api"
import { Problems } from "./LlmStepEditor"

export const SHEET_KIND_LABELS: Readonly<Record<SheetKind, { label: string }>> = {
  person: { label: "Person" },
  pet: { label: "Pet" },
  product: { label: "Product" },
  location: { label: "Location" },
}

export const SHEET_CONDITION_LABELS: Readonly<Record<SheetCondition, string>> = {
  "head-body": "head + body",
  "body-only": "body only",
  "head-only": "head only",
  unclear: "unclear",
}

/** A readable name for every layout id (the number is added by `layoutLabel`). */
const LAYOUT_NAMES: Readonly<Record<string, string>> = {
  collage: "Collage (no AI)",
  "head-body": "Head + body",
  "head-body-cut": "Head + body, cut out",
  "head-3q-body-cut": "Head, 3/4 view + body, cut out",
  "head-3q-front-back-cut": "Head, 3/4 view + front and back, cut out",
  "head-body-side": "Head + body, side",
  "head-3q-body": "Head, 3/4 view + body",
  "head-3q-side-back": "Head, 3/4 view + side and back",
  "front-3q": "Front + 3/4 view",
  turnaround: "Turnaround",
  "wide-detail": "Wide view + detail",
  none: "None (raw photos)",
}

/** A layout as the select shows it: "1 Collage (no AI)" (its place in the kind's list, from 1); "None (raw photos)" unnumbered. */
export function layoutLabel(layouts: readonly string[], layout: string): string {
  const name = LAYOUT_NAMES[layout] ?? layout
  if (layout === "none") return name
  const i = layouts.indexOf(layout)
  return i < 0 ? name : `${i + 1} ${name}`
}

/** The layouts that use no AI (no prompt). */
const NO_AI: ReadonlySet<string> = new Set(["collage", "none"])

interface Props {
  readonly value: SheetRules
  readonly onChange: (next: SheetRules) => void
  /** Each kind's layouts, in the design's numbering (the engine's list). */
  readonly layouts: { readonly [K in SheetKind]: readonly SheetLayout<K>[] }
  /** The engine's default rules. */
  readonly defaults: SheetRules
  /** Each layout's prompt per kind (null or left out for the collage and "none"). */
  readonly layoutPrompts: { readonly [K in SheetKind]: Partial<Record<SheetLayout<K>, string | null>> }
  /** The check's problems under `sheets.rules`, their paths relative to it ("person.head-only"). */
  readonly problems?: readonly CastSwapStepsProblem[]
  readonly disabled?: boolean
}

export function SheetRulesTable({ value, onChange, layouts, defaults, layoutPrompts, problems = [], disabled }: Props) {
  const isRtl = useAppDir() === "rtl"
  const id = useId()
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const toggle = (key: string) =>
    setOpen((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {SHEET_KINDS.map((kind) => {
        const list: readonly string[] = layouts[kind] ?? SHEET_LAYOUTS[kind]
        const rows = value[kind] as Record<SheetCondition, string>
        const isDefault = JSON.stringify(value[kind]) === JSON.stringify(defaults[kind])
        const kindProblems = problems.filter((p) => p.path === kind || p.path.startsWith(`${kind}.`))
        const captionId = `${id}-${kind}`
        return (
          <div key={kind} role="group" aria-labelledby={captionId} className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h5 id={captionId} className="text-sm font-semibold">
                {SHEET_KIND_LABELS[kind].label}
              </h5>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-9"
                disabled={disabled || isDefault}
                aria-label={`Reset the ${SHEET_KIND_LABELS[kind].label.toLowerCase()} rules to default`}
                onClick={() => onChange({ ...value, [kind]: { ...defaults[kind] } })}
              >
                Reset to default
              </Button>
            </div>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[22rem] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th scope="col" className="px-2 py-1.5 font-medium">
                      The photos cover
                    </th>
                    <th scope="col" className="px-2 py-1.5 font-medium">
                      Layout
                    </th>
                    <th scope="col" className="w-12 px-1 py-1.5">
                      <span className="sr-only">Prompt</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {SHEET_CONDITIONS.map((condition) => {
                    const layout = rows[condition]
                    const rowKey = `${kind}.${condition}`
                    const expanded = open.has(rowKey)
                    const prompt = (layoutPrompts[kind] as Partial<Record<string, string | null>> | undefined)?.[layout]
                    const conditionLabel = SHEET_CONDITION_LABELS[condition]
                    return (
                      <Fragment key={condition}>
                        <tr className="border-b last:border-b-0">
                          <th scope="row" className="whitespace-nowrap px-2 py-1 text-left font-normal">
                            {conditionLabel}
                          </th>
                          <td className="px-2 py-1">
                            <select
                              aria-label={`${SHEET_KIND_LABELS[kind].label}: ${conditionLabel}`}
                              className="h-9 min-h-9 w-full rounded-md border bg-background px-2 text-sm"
                              value={layout}
                              disabled={disabled}
                              onChange={(e) => onChange({ ...value, [kind]: { ...rows, [condition]: e.target.value } } as SheetRules)}
                            >
                              {!list.includes(layout) && <option value={layout}>{LAYOUT_NAMES[layout] ?? layout}</option>}
                              {list.map((l) => (
                                <option key={l} value={l}>
                                  {layoutLabel(list, l)}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-1 py-1 text-center">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-10 w-10"
                              aria-expanded={expanded}
                              aria-controls={`${id}-${rowKey}-prompt`}
                              aria-label={`${expanded ? "Hide" : "Show"} the ${SHEET_KIND_LABELS[kind].label.toLowerCase()} ${conditionLabel} prompt`}
                              onClick={() => toggle(rowKey)}
                            >
                              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className={isRtl ? "h-4 w-4 rotate-180" : "h-4 w-4"} />}
                            </Button>
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="border-b bg-muted/40 last:border-b-0">
                            <td colSpan={3} id={`${id}-${rowKey}-prompt`} className="px-2 py-2 text-xs">
                              {NO_AI.has(layout) ? (
                                <span className="text-muted-foreground">No prompt — no AI</span>
                              ) : prompt ? (
                                <p className="whitespace-pre-wrap break-words" data-testid="layout-prompt">
                                  {prompt}
                                </p>
                              ) : (
                                <span className="text-muted-foreground">The engine sent no prompt for this layout.</span>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Problems list={kindProblems} />
          </div>
        )
      })}
    </div>
  )
}
