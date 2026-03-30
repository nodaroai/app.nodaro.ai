"use client"

import { useCallback, useMemo, useEffect, useRef, useState } from "react"
import { Puzzle, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AspectRatioSelector } from "./aspect-ratio-selector"
import { useEdges } from "@xyflow/react"
import { getPublishedApp, estimateComponentCredits } from "@/lib/api"
import type { ConfigProps } from "./types"
import type { ComponentNodeData } from "@/types/nodes"
import type { ComponentMetadata, ExposedSetting } from "@nodaro-shared/component-types"

export function ComponentConfig({ data, onUpdate, nodeId }: ConfigProps<ComponentNodeData> & { nodeId?: string }) {
  const nodeData = data as ComponentNodeData
  const edges = useEdges()

  // Auto-refresh metadata + credits from the latest published version on first open.
  // Also pre-populates exposedSettings with defaults so selects show current values.
  const [freshMeta, setFreshMeta] = useState<ComponentMetadata | null>(null)
  const refreshed = useRef(false)
  useEffect(() => {
    if (refreshed.current || !nodeData.appSlug) return
    refreshed.current = true
    getPublishedApp(nodeData.appSlug, nodeData.pinnedVersion || undefined)
      .then((app) => {
        const fresh = app.componentMetadata as ComponentMetadata | null
        if (fresh) {
          setFreshMeta(fresh) // immediate local update
          onUpdate({ componentMetadata: fresh }) // persist to store

          // Pre-populate exposedSettings with defaults from metadata so
          // select dropdowns show the current value on first open.
          const defaults: Record<string, unknown> = {}
          for (const s of fresh.exposedSettings ?? []) {
            const key = `${s.nodeId}:${s.field}`
            if (nodeData.exposedSettings[key] === undefined && s.defaultValue !== undefined) {
              defaults[key] = s.defaultValue
            }
          }
          if (Object.keys(defaults).length > 0) {
            onUpdate({ exposedSettings: { ...nodeData.exposedSettings, ...defaults } })
          }
        }
        if (app.estimatedCredits != null && app.estimatedCredits !== nodeData.estimatedCredits) {
          onUpdate({ estimatedCredits: app.estimatedCredits })
        }
      })
      .catch(() => {})
  }, [nodeData.appSlug, nodeData.pinnedVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  const rawMeta = freshMeta ?? nodeData.componentMetadata ?? { inputs: [], outputs: [], exposedSettings: [] }

  // Deduplicate outputs by handle id and settings by nodeId:field to handle
  // any stale/duplicate metadata from previous publishes.
  const meta = useMemo(() => {
    const seenOutputs = new Set<string>()
    const outputs = (rawMeta.outputs ?? []).filter((h) => {
      if (seenOutputs.has(h.id)) return false
      seenOutputs.add(h.id)
      return true
    })
    const seenSettings = new Set<string>()
    const exposedSettings = (rawMeta.exposedSettings ?? []).filter((s) => {
      const key = `${s.nodeId}:${s.field}`
      if (seenSettings.has(key)) return false
      seenSettings.add(key)
      return true
    })
    return { ...rawMeta, outputs, exposedSettings }
  }, [rawMeta])

  // Determine which input handles have a wired connection
  const connectedInputIds = useMemo(() => {
    if (!nodeId) return new Set<string>()
    const set = new Set<string>()
    for (const e of edges) {
      if (e.target === nodeId && e.targetHandle?.startsWith("in_")) {
        set.add(e.targetHandle.replace(/^in_/, ""))
      }
    }
    return set
  }, [edges, nodeId])

  // Debounced credit re-estimation when settings change
  const creditTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reEstimateCredits = useCallback((newSettings: Record<string, unknown>) => {
    if (!nodeData.appSlug) return
    if (creditTimer.current) clearTimeout(creditTimer.current)
    creditTimer.current = setTimeout(() => {
      estimateComponentCredits({
        appSlug: nodeData.appSlug,
        pinnedVersion: nodeData.pinnedVersion || undefined,
        exposedSettings: newSettings,
      })
        .then((res) => {
          if (res.estimatedCredits > 0) onUpdate({ estimatedCredits: res.estimatedCredits })
        })
        .catch(() => {})
    }, 400)
  }, [nodeData.appSlug, nodeData.pinnedVersion, onUpdate])

  const handleSettingChange = useCallback((setting: ExposedSetting, value: unknown) => {
    const key = `${setting.nodeId}:${setting.field}`
    const newSettings = { ...nodeData.exposedSettings, [key]: value }
    onUpdate({ exposedSettings: newSettings })
    reEstimateCredits(newSettings)
  }, [nodeData.exposedSettings, onUpdate, reEstimateCredits])

  // Input handle values are stored in exposedSettings with the same "nodeId:fieldKey" format
  const handleInputChange = useCallback((handleId: string, fieldKey: string, value: string) => {
    const key = `${handleId}:${fieldKey}`
    onUpdate({
      exposedSettings: {
        ...nodeData.exposedSettings,
        [key]: value,
      },
    })
  }, [nodeData.exposedSettings, onUpdate])

  const getSettingValue = (setting: ExposedSetting): unknown => {
    const key = `${setting.nodeId}:${setting.field}`
    const val = nodeData.exposedSettings[key]
    return val !== undefined ? val : setting.defaultValue
  }

  const getInputValue = (handleId: string, fieldKey: string): string => {
    const key = `${handleId}:${fieldKey}`
    const val = nodeData.exposedSettings[key]
    return typeof val === "string" ? val : ""
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Info card */}
      <div className="rounded-lg bg-gray-100 dark:bg-[#1a1a2e] border border-gray-200 dark:border-[#2D2D2D] p-3">
        <div className="flex items-center gap-2 mb-1">
          <Puzzle className="w-4 h-4 text-[#ff0073]" />
          <span className="text-sm font-medium truncate">{nodeData.label || "Component"}</span>
        </div>
        {nodeData.pinnedVersion > 0 && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 mt-1">
            v{nodeData.pinnedVersion}
          </Badge>
        )}
      </div>

      {/* Input handles — editable when not wired */}
      {meta.inputs.length > 0 && (
        <div className="flex flex-col gap-3">
          <Label className="text-xs font-medium">Inputs</Label>
          {meta.inputs.map((h) => {
            const isConnected = connectedInputIds.has(h.id)
            return (
              <div key={h.id}>
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-[10px] text-muted-foreground">
                    {h.name}
                    {h.required && <span className="text-red-400 ml-0.5">*</span>}
                  </Label>
                  <Badge variant="outline" className="text-[9px] px-1 py-0">{h.type}</Badge>
                </div>
                {isConnected ? (
                  <div className="text-[10px] text-muted-foreground/60 italic px-2 py-1.5 bg-muted/30 rounded-md">
                    Connected from upstream
                  </div>
                ) : h.type === "text" ? (
                  <Textarea
                    className="text-xs min-h-[60px]"
                    placeholder={`Enter ${h.name.toLowerCase()}...`}
                    value={getInputValue(h.id, h.fieldKey)}
                    onChange={(e) => handleInputChange(h.id, h.fieldKey, e.target.value)}
                  />
                ) : (
                  <div className="text-[10px] text-muted-foreground/60 italic px-2 py-1.5 bg-muted/30 rounded-md">
                    Connect {h.type} from upstream node
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Exposed settings */}
      {(meta.exposedSettings ?? []).length > 0 && (
        <div className="flex flex-col gap-3">
          <Label className="text-xs font-medium">Settings</Label>
          {(meta.exposedSettings ?? []).map((setting) => {
            const key = `${setting.nodeId}:${setting.field}`
            const value = getSettingValue(setting)

            switch (setting.type) {
              case "aspect-ratio": {
                const opts = setting.options ?? (setting.allowedValues ?? []).map((v) => ({ value: String(v), label: String(v) }))
                return (
                  <div key={key}>
                    <Label className="text-[10px] text-muted-foreground">{setting.label}</Label>
                    <AspectRatioSelector
                      options={opts}
                      value={String(value ?? "")}
                      onValueChange={(v) => handleSettingChange(setting, v)}
                      className="mt-1"
                    />
                  </div>
                )
              }
              case "select": {
                // Prefer options (value+label) over raw allowedValues
                const opts: Array<{ value: string; label: string }> = setting.options
                  ?? (setting.allowedValues ?? []).map((v) => ({ value: String(v), label: String(v) }))
                // Ensure the current value is in the options list (may be absent if
                // the option set changed after the component was published).
                const strVal = String(value ?? "")
                const hasCurrentValue = !strVal || opts.some((o) => o.value === strVal)
                const displayOpts = hasCurrentValue ? opts : [{ value: strVal, label: strVal }, ...opts]
                return (
                  <div key={key}>
                    <Label className="text-[10px] text-muted-foreground">{setting.label}</Label>
                    <Select
                      value={strVal}
                      onValueChange={(v) => handleSettingChange(setting, v)}
                    >
                      <SelectTrigger className="mt-1 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {displayOpts.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )
              }
              case "toggle":
                return (
                  <div key={key} className="flex items-center justify-between">
                    <Label className="text-[10px] text-muted-foreground">{setting.label}</Label>
                    <Switch
                      checked={!!value}
                      onCheckedChange={(v) => handleSettingChange(setting, v)}
                    />
                  </div>
                )
              case "number":
                return (
                  <div key={key}>
                    <Label className="text-[10px] text-muted-foreground">{setting.label}</Label>
                    <Input
                      type="number"
                      className="mt-1 h-8 text-xs"
                      value={value !== undefined && value !== null ? String(value) : ""}
                      onChange={(e) => handleSettingChange(setting, e.target.value === "" ? undefined : Number(e.target.value))}
                    />
                  </div>
                )
              case "text":
              default:
                return (
                  <div key={key}>
                    <Label className="text-[10px] text-muted-foreground">{setting.label}</Label>
                    <Input
                      className="mt-1 h-8 text-xs"
                      value={String(value ?? "")}
                      onChange={(e) => handleSettingChange(setting, e.target.value)}
                    />
                  </div>
                )
            }
          })}
        </div>
      )}

      {/* Outputs (read-only) */}
      {meta.outputs.length > 0 && (
        <div>
          <Label className="text-xs font-medium">Outputs</Label>
          <div className="flex flex-col gap-1 mt-1">
            {meta.outputs.map((h) => (
              <div key={h.id} className="flex items-center justify-between text-[10px]">
                <span className="text-muted-foreground">{h.name}</span>
                <Badge variant="outline" className="text-[9px] px-1 py-0">{h.type}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
