"use client"

import { useCallback } from "react"
import { Puzzle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { ConfigProps } from "./types"
import type { ComponentNodeData } from "@/types/nodes"
import type { ExposedSetting } from "@nodaro-shared/component-types"

export function ComponentConfig({ data, onUpdate }: ConfigProps<ComponentNodeData>) {
  const nodeData = data as ComponentNodeData
  const meta = nodeData.componentMetadata

  const handleSettingChange = useCallback((setting: ExposedSetting, value: unknown) => {
    const key = `${setting.nodeId}:${setting.field}`
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

  return (
    <div className="flex flex-col gap-4">
      {/* Info card */}
      <div className="rounded-lg bg-gray-100 dark:bg-[#1a1a2e] border border-gray-200 dark:border-[#2D2D2D] p-3">
        <div className="flex items-center gap-2 mb-2">
          <Puzzle className="w-4 h-4 text-[#ff0073]" />
          <span className="text-sm font-medium truncate">{nodeData.label || "Component"}</span>
        </div>
        {nodeData.creatorName && (
          <p className="text-[10px] text-muted-foreground mb-1.5">
            by @{nodeData.creatorName}
          </p>
        )}
        <div className="flex items-center gap-1.5 flex-wrap">
          {nodeData.pinnedVersion > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              v{nodeData.pinnedVersion}
            </Badge>
          )}
          {nodeData.estimatedCredits > 0 && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {nodeData.estimatedCredits} CR
            </Badge>
          )}
        </div>
      </div>

      {/* Exposed settings */}
      {meta.exposedSettings.length > 0 && (
        <div className="flex flex-col gap-3">
          <Label className="text-xs font-medium">Settings</Label>
          {meta.exposedSettings.map((setting) => {
            const key = `${setting.nodeId}:${setting.field}`
            const value = getSettingValue(setting)

            switch (setting.type) {
              case "select":
                return (
                  <div key={key}>
                    <Label className="text-[10px] text-muted-foreground">{setting.label}</Label>
                    <Select
                      value={String(value ?? "")}
                      onValueChange={(v) => handleSettingChange(setting, v)}
                    >
                      <SelectTrigger className="mt-1 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(setting.allowedValues ?? []).map((opt) => (
                          <SelectItem key={String(opt)} value={String(opt)}>
                            {String(opt)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )
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

      {/* Inputs / Outputs */}
      {(meta.inputs.length > 0 || meta.outputs.length > 0) && (
        <div className="flex flex-col gap-3">
          {meta.inputs.length > 0 && (
            <div>
              <Label className="text-xs font-medium">Inputs</Label>
              <div className="flex flex-col gap-1 mt-1">
                {meta.inputs.map((h) => (
                  <div key={h.id} className="flex items-center justify-between text-[10px]">
                    <span className="text-muted-foreground">{h.name}</span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0">
                      {h.type}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
          {meta.outputs.length > 0 && (
            <div>
              <Label className="text-xs font-medium">Outputs</Label>
              <div className="flex flex-col gap-1 mt-1">
                {meta.outputs.map((h) => (
                  <div key={h.id} className="flex items-center justify-between text-[10px]">
                    <span className="text-muted-foreground">{h.name}</span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0">
                      {h.type}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
