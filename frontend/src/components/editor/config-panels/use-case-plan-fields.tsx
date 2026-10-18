"use client"

import { EDIT_PLAN_TIERS, type EditPlanTier } from "@nodaro/shared/edl"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useT, type MessageKey } from "@/lib/i18n"

const PLAN_TIER_LABEL_KEYS: Readonly<Record<EditPlanTier, MessageKey>> = {
  economy: "proccfg.tightenTierEconomy",
  standard: "proccfg.tightenTierStandard",
  premium: "proccfg.tightenTierPremium",
}

/** The plan settings every use-case node's panel shows, as its node data holds them. */
export interface UseCasePlanValues {
  readonly planTier?: EditPlanTier
  readonly instructions?: string
  readonly styleGuide?: string
}

/**
 * The plan step's settings of a use-case node (Tighten Episode, Chapters, …):
 * its tier, and the instructions and style guide the planner reads. Each
 * node names its own tier label (what the plan decides differs) and its
 * element ids; the tier shown when none is stored is the node's own default.
 */
export function UseCasePlanFields({
  data,
  onUpdate,
  defaultTier,
  tierLabelKey,
  idPrefix,
}: {
  readonly data: UseCasePlanValues
  readonly onUpdate: (patch: Partial<UseCasePlanValues>) => void
  readonly defaultTier: EditPlanTier
  readonly tierLabelKey: MessageKey
  readonly idPrefix: string
}) {
  const t = useT()
  return (
    <>
      <div className="space-y-1.5">
        <Label>{t(tierLabelKey)}</Label>
        <Select value={data.planTier ?? defaultTier} onValueChange={(v) => onUpdate({ planTier: v as EditPlanTier })}>
          <SelectTrigger aria-label={t(tierLabelKey)}><SelectValue /></SelectTrigger>
          <SelectContent>
            {EDIT_PLAN_TIERS.map((tier) => <SelectItem key={tier} value={tier}>{t(PLAN_TIER_LABEL_KEYS[tier])}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-instructions`}>{t("proccfg.tightenInstructions")}</Label>
        <Textarea id={`${idPrefix}-instructions`} rows={3} value={data.instructions ?? ""} onChange={(e) => onUpdate({ instructions: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-style`}>{t("proccfg.tightenStyleGuide")}</Label>
        <Textarea id={`${idPrefix}-style`} rows={2} value={data.styleGuide ?? ""} onChange={(e) => onUpdate({ styleGuide: e.target.value })} />
      </div>
    </>
  )
}
