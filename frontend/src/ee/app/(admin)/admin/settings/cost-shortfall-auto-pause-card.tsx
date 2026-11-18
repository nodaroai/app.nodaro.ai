// Admin → Settings → Pricing safety: whether a model whose jobs keep being
// charged less than their provider cost is switched off automatically
// (backend ee/billing/cost-shortfall-sweep.ts). Saves on toggle, like an
// emergency switch should; on by default (an absent row reads as on).

import { useState } from "react"
import { ShieldAlert } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useAdminSettings } from "@/ee/hooks/queries/use-admin-queries"
import { useUpdateSettingMutation } from "@/hooks/queries/use-app-settings-queries"

export function CostShortfallAutoPauseCard() {
  const { data: settings } = useAdminSettings()
  const update = useUpdateSettingMutation()
  const [error, setError] = useState<string | null>(null)
  const enabled = settings?.cost_shortfall_auto_pause_enabled ?? true

  const toggle = async (value: boolean) => {
    setError(null)
    try {
      await update.mutateAsync({ key: "cost_shortfall_auto_pause_enabled", value })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save")
    }
  }

  return (
    <div className="border rounded-lg p-4 bg-card">
      <div className="flex items-center gap-2 mb-4">
        <ShieldAlert className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-medium">Pricing safety</h2>
      </div>
      <div className="flex items-center justify-between">
        <div className="pr-4">
          <Label htmlFor="cost-shortfall-auto-pause">Switch off models that lose money</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Every completed job is compared with what the provider billed for it. When 5 jobs of one model are
            charged under half their cost within 60 minutes, the model is switched off and an alert is filed in
            App Reports. Switch it back on at Models once its price is fixed. Turned off, losing jobs are still
            recorded under Credit Anomalies and alerted, and no model is switched off.
          </p>
          {error && <p className="text-xs text-destructive mt-1">{error}</p>}
        </div>
        <Switch
          id="cost-shortfall-auto-pause"
          checked={enabled}
          disabled={!settings || update.isPending}
          onCheckedChange={(value) => void toggle(value)}
        />
      </div>
    </div>
  )
}
