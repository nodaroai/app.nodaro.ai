"use client"

import { useState, useEffect } from "react"
import { Loader2, Globe, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { toast } from "sonner"

const API_BASE = ""

const PRIVATE_MODE_TIERS = new Set(["standard", "pro", "business"])

export default function SettingsPage() {
  const { user, loading: authLoading } = useAuth()
  const [publicOutputs, setPublicOutputs] = useState(true)
  const [tier, setTier] = useState<string>("free")
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!user?.id) return

    async function fetchSettings() {
      setSettingsLoading(true)
      try {
        const response = await fetch(`${API_BASE}/v1/user/settings?userId=${user!.id}`)
        if (!response.ok) throw new Error("Failed to fetch settings")
        const json = await response.json()
        const data = json.data ?? json
        setPublicOutputs(data.publicOutputs ?? true)
        setTier(data.tier ?? "free")
      } catch (err) {
        console.error("Failed to load settings:", err)
      } finally {
        setSettingsLoading(false)
      }
    }

    fetchSettings()
  }, [user?.id])

  async function handleToggle() {
    if (!user?.id) return

    const newValue = !publicOutputs
    setSaving(true)
    try {
      const response = await fetch(`${API_BASE}/v1/user/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, publicOutputs: newValue }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Failed" }))
        throw new Error(err.error ?? "Failed to update")
      }

      setPublicOutputs(newValue)
      toast.success(newValue ? "Outputs are now public" : "Outputs are now private")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update"
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  const canToggle = PRIVATE_MODE_TIERS.has(tier)

  if (authLoading || settingsLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      {/* Gallery Visibility */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              {publicOutputs ? (
                <Globe className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Lock className="h-4 w-4 text-muted-foreground" />
              )}
              <h2 className="text-base font-semibold">Gallery Visibility</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {publicOutputs
                ? "Your generated images, videos, and audio appear in the public gallery."
                : "Your outputs are private and hidden from the gallery."}
            </p>
          </div>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canToggle || saving}
                    onClick={handleToggle}
                    className={cn(
                      "min-w-[100px]",
                      !publicOutputs && canToggle && "border-[#ff0073] text-[#ff0073]",
                    )}
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : publicOutputs ? (
                      "Make Private"
                    ) : (
                      "Make Public"
                    )}
                  </Button>
                </span>
              </TooltipTrigger>
              {!canToggle && (
                <TooltipContent>
                  Available on Standard plan and above
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
  )
}
