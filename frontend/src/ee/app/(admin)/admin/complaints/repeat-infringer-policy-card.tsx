import { useState } from "react"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  MEASURE_KINDS,
  measureNeedsDays,
  measureTakesDays,
  useRepeatInfringerPolicy,
  useSaveRepeatInfringerPolicy,
  type MeasureKind,
  type RepeatInfringerPolicy,
} from "@/ee/hooks/queries/use-admin-repeat-infringers"
import { MEASURE_LABELS, formatWhen, measureLabel } from "./complaint-labels"
import { MAX_POLICY_STEPS, fromDraft, policyProblem, toDraft, withNewStep, withStep, withoutStep, type PolicyDraft, type StepDraft } from "./policy-state"

/**
 * The repeat-infringer policy, on the Complaints screen: the measure each
 * count of an account's standing infringements reaches, over a rolling
 * window. A guide the record follows, never applied by itself: the case
 * shows the step, and an administrator takes it or says why not. A change
 * applies to measures taken from then on; each measure keeps the step it
 * followed.
 */
export function RepeatInfringerPolicyCard() {
  const { data, isLoading, isError, error } = useRepeatInfringerPolicy()
  const [editing, setEditing] = useState(false)
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="repeat-infringer-policy-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="repeat-infringer-policy-heading" className="text-sm font-semibold">Repeat-infringer policy</h2>
        {data && !editing && <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button>}
      </div>
      {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />}
      {isError && <p className="text-sm text-red-600">{error instanceof Error ? error.message : "Failed to load the policy"}</p>}
      {data && !editing && <PolicyView policy={data.policy} saved={data.saved} updatedAt={data.updatedAt} />}
      {data && editing && <PolicyEditor policy={data.policy} onDone={() => setEditing(false)} />}
    </section>
  )
}

function PolicyView({ policy, saved, updatedAt }: { readonly policy: RepeatInfringerPolicy; readonly saved: boolean; readonly updatedAt: string | null }) {
  return (
    <div className="space-y-2 text-sm">
      <p className="text-muted-foreground">
        Standing infringements are counted over the last {policy.windowMonths} months. {saved ? `Saved ${formatWhen(updatedAt)}.` : "The default: never changed."}
      </p>
      <ul className="divide-y rounded-md border">
        {policy.steps.map((s) => (
          <li key={s.infringements} className="flex flex-wrap items-center gap-x-3 px-3 py-2">
            <span className="w-40 text-muted-foreground">From {s.infringements} infringement{s.infringements === 1 ? "" : "s"}</span>
            <span>{measureLabel(s.kind, s.days)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** One step of the draft: its count, its measure, and an import block's or a suspension's days. */
function StepRow({ step, index, onChange, onRemove }: { readonly step: StepDraft; readonly index: number; readonly onChange: (patch: Partial<StepDraft>) => void; readonly onRemove: () => void }) {
  return (
    <li className="flex flex-wrap items-end gap-2 px-3 py-2">
      <div className="space-y-1">
        <Label htmlFor={`policy-step-${index}`}>From infringements</Label>
        <Input id={`policy-step-${index}`} className="w-24" inputMode="numeric" value={step.infringements} onChange={(e) => onChange({ infringements: e.target.value })} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`policy-kind-${index}`}>Measure</Label>
        <Select value={step.kind} onValueChange={(v) => onChange({ kind: v as MeasureKind })}>
          <SelectTrigger id={`policy-kind-${index}`} className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MEASURE_KINDS.map((k) => <SelectItem key={k} value={k}>{MEASURE_LABELS[k]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {measureTakesDays(step.kind) && (
        <div className="space-y-1">
          <Label htmlFor={`policy-days-${index}`}>{measureNeedsDays(step.kind) ? "Days" : "Days (empty: until lifted)"}</Label>
          <Input id={`policy-days-${index}`} className="w-28" inputMode="numeric" value={step.days} onChange={(e) => onChange({ days: e.target.value })} />
        </div>
      )}
      <Button type="button" size="sm" variant="ghost" onClick={onRemove} aria-label={`Remove step ${index + 1}`}>
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </Button>
    </li>
  )
}

function PolicyEditor({ policy, onDone }: { readonly policy: RepeatInfringerPolicy; readonly onDone: () => void }) {
  const [draft, setDraft] = useState<PolicyDraft>(() => toDraft(policy))
  const save = useSaveRepeatInfringerPolicy()
  const problem = policyProblem(draft)
  async function submit() {
    const next = fromDraft(draft)
    if (!next) return
    try {
      await save.mutateAsync(next)
      toast.success("Policy saved")
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save the policy")
    }
  }
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit() }} aria-label="Edit the repeat-infringer policy">
      <div className="space-y-1">
        <Label htmlFor="policy-window">Window, in months</Label>
        <Input id="policy-window" className="w-24" inputMode="numeric" value={draft.windowMonths} onChange={(e) => setDraft({ ...draft, windowMonths: e.target.value })} />
      </div>
      <ul className="divide-y rounded-md border">
        {draft.steps.map((s, i) => (
          <StepRow key={i} step={s} index={i} onChange={(patch) => setDraft(withStep(draft, i, patch))} onRemove={() => setDraft(withoutStep(draft, i))} />
        ))}
      </ul>
      <Button type="button" size="sm" variant="outline" onClick={() => setDraft(withNewStep(draft))} disabled={draft.steps.length >= MAX_POLICY_STEPS}>
        <Plus className="me-2 h-4 w-4" aria-hidden="true" />
        Add a step
      </Button>
      {problem && <p role="alert" className="text-sm text-red-600">{problem}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={problem !== null || save.isPending}>
          {save.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          Save the policy
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={save.isPending}>Cancel</Button>
      </div>
    </form>
  )
}
