import { useEffect, useState, useCallback } from "react"
import { Bell, Plus, Trash2, Loader2, AlertTriangle, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

import { API_BASE_URL } from "@/lib/api"

interface Alert {
  readonly id: string
  readonly alert_type: string
  readonly threshold: number
  readonly user_id: string | null
  readonly is_enabled: boolean
  readonly created_at: string
}

const ALERT_TYPE_LABELS: Record<string, string> = {
  cost_overrun: "Cost Overrun",
  credit_low: "Low Credits",
  usage_spike: "Usage Spike",
}

export default function AdminAlertsPage() {
  const [alerts, setAlerts] = useState<ReadonlyArray<Alert>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  // Form state
  const [newAlertType, setNewAlertType] = useState<string>("cost_overrun")
  const [newThreshold, setNewThreshold] = useState("100")

  const fetchAlerts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE_URL}/v1/admin/alerts`)
      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        throw new Error(errData?.error?.message || `Request failed: ${res.status}`)
      }
      const json = await res.json()
      setAlerts(json.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch alerts")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAlerts()
  }, [fetchAlerts])

  const handleCreate = async () => {
    setSaving(true)
    try {
      const res = await fetch(`${API_BASE_URL}/v1/admin/alerts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alertType: newAlertType,
          threshold: Number(newThreshold) || 0,
          isEnabled: true,
        }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        throw new Error(errData?.error?.message || `Request failed: ${res.status}`)
      }
      setDialogOpen(false)
      setNewAlertType("cost_overrun")
      setNewThreshold("100")
      await fetchAlerts()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create alert")
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (alert: Alert) => {
    try {
      const res = await fetch(`${API_BASE_URL}/v1/admin/alerts/${alert.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isEnabled: !alert.is_enabled }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        throw new Error(errData?.error?.message || `Request failed: ${res.status}`)
      }
      await fetchAlerts()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update alert")
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/v1/admin/alerts/${id}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        throw new Error(errData?.error?.message || `Request failed: ${res.status}`)
      }
      await fetchAlerts()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete alert")
    }
  }

  if (loading && alerts.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Cost Alerts</h1>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              New Alert
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Cost Alert</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="alert-type">Alert Type</Label>
                <Select value={newAlertType} onValueChange={setNewAlertType}>
                  <SelectTrigger id="alert-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cost_overrun">Cost Overrun</SelectItem>
                    <SelectItem value="credit_low">Low Credits</SelectItem>
                    <SelectItem value="usage_spike">Usage Spike</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="threshold">
                  Threshold {newAlertType === "cost_overrun" ? "(USD)" : newAlertType === "credit_low" ? "(credits)" : "(% above normal)"}
                </Label>
                <Input
                  id="threshold"
                  type="number"
                  min={0}
                  value={newThreshold}
                  onChange={(e) => setNewThreshold(e.target.value)}
                />
              </div>
              <Button onClick={handleCreate} disabled={saving} className="w-full">
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Alert"
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-500 text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {alerts.length === 0 ? (
        <div className="border rounded-lg p-8 bg-card text-center">
          <Bell className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No alerts configured yet.</p>
          <p className="text-sm text-muted-foreground mt-1">
            Create alerts to monitor cost overruns, low credits, and usage spikes.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className="border rounded-lg p-4 bg-card flex items-center gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">
                    {ALERT_TYPE_LABELS[alert.alert_type] ?? alert.alert_type}
                  </span>
                  <Badge variant={alert.is_enabled ? "default" : "secondary"}>
                    {alert.is_enabled ? "Active" : "Disabled"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Threshold: {alert.alert_type === "cost_overrun"
                    ? `$${alert.threshold}`
                    : alert.alert_type === "usage_spike"
                      ? `${alert.threshold}% above normal`
                      : `${alert.threshold} credits`}
                </p>
                <p className="text-xs text-muted-foreground">
                  Created: {new Date(alert.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleToggle(alert)}
                  className="h-8"
                >
                  {alert.is_enabled ? "Disable" : "Enable"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(alert.id)}
                  className="h-8 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
