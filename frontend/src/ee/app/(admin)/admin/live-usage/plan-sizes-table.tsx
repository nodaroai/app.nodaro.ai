import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { boundsMessage, LANE_LABELS, tierLabel, wholeIn } from "./format"
import { LANES, type Bounds, type Lane, type LaneConfig, type LaneSizes } from "./types"
import { useSavePlanSizes } from "./use-live-usage"

type Draft = Record<Lane, string>

const draftOf = (sizes: LaneSizes): Draft => Object.fromEntries(LANES.map((l) => [l, String(sizes[l])])) as Draft

/**
 * One plan's row: its four sizes, saved together (the PUT replaces the row).
 * The row follows the server until the admin edits it and keeps their edits
 * however often the configuration is read again.
 */
function PlanRow({ tier, sizes, bounds }: { tier: string; sizes: LaneSizes; bounds: Bounds }) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(sizes))
  const [dirty, setDirty] = useState(false)
  const save = useSavePlanSizes()
  const serverKey = JSON.stringify(sizes)
  const [seenKey, setSeenKey] = useState(serverKey)
  if (serverKey !== seenKey) {
    setSeenKey(serverKey)
    if (!dirty) setDraft(draftOf(sizes))
  }

  const values = Object.fromEntries(LANES.map((l) => [l, wholeIn(draft[l], bounds)])) as Record<Lane, number | null>
  const invalid = LANES.find((l) => values[l] === null)

  const submit = () => {
    if (invalid) return
    save.mutate({ tier, sizes: values as LaneSizes }, { onSuccess: () => setDirty(false) })
  }

  return (
    <tr className="border-b align-top last:border-0">
      <td className="py-2 pe-3 font-medium">{tierLabel(tier)}</td>
      {LANES.map((l) => (
        <td key={l} className="py-1.5 pe-2">
          <Input
            type="number"
            inputMode="numeric"
            min={bounds.min}
            max={bounds.max}
            aria-label={`${tier} ${LANE_LABELS[l]}`}
            className="h-8 w-20 tabular-nums"
            value={draft[l]}
            onChange={(e) => {
              setDirty(true)
              setDraft({ ...draft, [l]: e.target.value })
            }}
          />
        </td>
      ))}
      <td className="space-y-1 py-1.5">
        <Button size="sm" variant="outline" onClick={submit} disabled={!dirty || save.isPending || invalid !== undefined}>
          {save.isPending && <Loader2 className="me-2 h-3.5 w-3.5 animate-spin" />}
          Save
        </Button>
        {invalid && <p className="text-xs text-destructive">{boundsMessage(LANE_LABELS[invalid], bounds)}</p>}
        {save.error && <p className="text-xs text-destructive">{save.error.message}</p>}
        {save.isSuccess && !dirty && <p className="text-xs text-muted-foreground">Saved.</p>}
      </td>
    </tr>
  )
}

function ReadOnlyRow({ label, sizes }: { label: string; sizes: LaneSizes }) {
  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pe-3 font-medium">{label}</td>
      {LANES.map((l) => <td key={l} className="py-2 pe-2 tabular-nums">{sizes[l]}</td>)}
    </tr>
  )
}

/**
 * How many of each lane one line runs at once, per plan (Cloud). Elsewhere
 * there are no plans: every line has the same sizes, set by the server's
 * environment, shown read-only.
 */
export function PlanSizesTable({ config }: { config: LaneConfig }) {
  const plans = Object.entries(config.plans)
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Plan sizes</h3>
      <p className="text-xs text-muted-foreground">
        {config.editable
          ? "How many jobs of each lane one line runs at once, per plan. A user's override wins over their plan. A change applies within a minute; lowering a size stops nothing that runs."
          : "There are no plans here: every line has the same sizes, set by the server's environment (LANE_PROVIDER_PER_USER, LANE_LLM_PER_USER, LANE_LOCAL_PER_USER, LANE_RUN_PER_USER)."}
      </p>
      <div className="overflow-x-auto">
        <table aria-label="Plan sizes" className="text-sm">
          <thead>
            <tr className="border-b text-start text-xs text-muted-foreground">
              <th className="py-1.5 pe-3 text-start font-medium">Plan</th>
              {LANES.map((l) => <th key={l} className="py-1.5 pe-2 text-start font-medium">{LANE_LABELS[l]}</th>)}
              {config.editable && <th className="py-1.5 text-start font-medium"><span className="sr-only">Save</span></th>}
            </tr>
          </thead>
          <tbody>
            {config.editable
              ? plans.map(([tier, sizes]) => <PlanRow key={tier} tier={tier} sizes={sizes} bounds={config.bounds.laneSize} />)
              : config.envSizes && <ReadOnlyRow label="Every line" sizes={config.envSizes} />}
          </tbody>
        </table>
      </div>
    </section>
  )
}
