"use client"

import { useState } from "react"
import { Copy, Check, Plus, Trash2 } from "lucide-react"
import { nanoid } from "nanoid"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { WebhookParam } from "@/types/nodes"
import type { ConfigProps } from "./types"

// ── Webhook Trigger ────────────────────────────────────────────

interface WebhookTriggerData {
  webhookToken?: string
  webhookUrl?: string
  label?: string
  params?: WebhookParam[]
}

export function WebhookTriggerConfig({ data, onUpdate }: ConfigProps<WebhookTriggerData>) {
  const [copied, setCopied] = useState(false)

  const webhookUrl = data.webhookUrl || ""
  const hasToken = !!data.webhookToken
  const params = data.params ?? []

  const handleCopy = () => {
    if (!webhookUrl) return
    navigator.clipboard.writeText(webhookUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const addParam = () => {
    onUpdate({
      params: [...params, { id: nanoid(), name: "", type: "text" }],
    })
  }

  const updateParam = (index: number, patch: Partial<WebhookParam>) => {
    const updated = params.map((p, i) => (i === index ? { ...p, ...patch } : p))
    onUpdate({ params: updated })
  }

  const removeParam = (index: number) => {
    onUpdate({ params: params.filter((_, i) => i !== index) })
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Webhook URL</Label>
        {hasToken ? (
          <div className="flex items-center gap-2 mt-1">
            <Input
              value={webhookUrl}
              readOnly
              className="text-xs font-mono bg-muted/30"
            />
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 h-9 w-9 p-0"
              onClick={handleCopy}
              title="Copy URL"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground mt-1 p-2 bg-muted/30 rounded-md border border-dashed border-border">
            Create a trigger in Workflow Settings to generate a webhook URL.
          </p>
        )}
      </div>

      {hasToken && (
        <div className="text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2 border border-border">
          <span className="font-medium">Token:</span>{" "}
          <span className="font-mono">{data.webhookToken}</span>
        </div>
      )}

      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between mb-2">
          <Label>Output Parameters</Label>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addParam}>
            <Plus className="h-3 w-3" />
            Add
          </Button>
        </div>

        {params.length === 0 && (
          <p className="text-[10px] text-muted-foreground bg-muted/30 rounded-md px-3 py-2 border border-dashed border-border">
            No parameters defined. The entire payload will be available as a single output.
          </p>
        )}

        <div className="flex flex-col gap-2">
          {params.map((param, i) => (
            <div key={param.id} className="flex items-center gap-1.5">
              <Input
                value={param.name}
                onChange={(e) => updateParam(i, { name: e.target.value })}
                placeholder="name"
                className="text-xs h-8 flex-1"
              />
              <Select
                value={param.type}
                onValueChange={(v) => updateParam(i, { type: v as WebhookParam["type"] })}
              >
                <SelectTrigger className="h-8 w-[100px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Text</SelectItem>
                  <SelectItem value="imageUrl">Image URL</SelectItem>
                  <SelectItem value="videoUrl">Video URL</SelectItem>
                  <SelectItem value="audioUrl">Audio URL</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => removeParam(i)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Schedule Trigger ───────────────────────────────────────────

interface ScheduleTriggerData {
  cronExpression?: string
  interval?: string
  timezone?: string
  maxExecutions?: number
  label?: string
}

const INTERVAL_OPTIONS = [
  { value: "*/5 * * * *", label: "Every 5 minutes" },
  { value: "*/15 * * * *", label: "Every 15 minutes" },
  { value: "0 * * * *", label: "Every hour" },
  { value: "0 0 * * *", label: "Every day (midnight)" },
  { value: "custom", label: "Custom cron..." },
]

export function ScheduleTriggerConfig({ data, onUpdate }: ConfigProps<ScheduleTriggerData>) {
  const currentInterval = data.interval || ""
  const isCustom = currentInterval === "custom" || (
    currentInterval !== "" && !INTERVAL_OPTIONS.some((o) => o.value === currentInterval)
  )
  const selectValue = isCustom ? "custom" : currentInterval || ""

  const handleIntervalChange = (value: string) => {
    if (value === "custom") {
      onUpdate({ interval: "custom", cronExpression: data.cronExpression || "" })
    } else {
      onUpdate({ interval: value, cronExpression: value })
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Interval</Label>
        <Select value={selectValue} onValueChange={handleIntervalChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select interval..." />
          </SelectTrigger>
          <SelectContent>
            {INTERVAL_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isCustom && (
        <div>
          <Label htmlFor="cron-expression">Cron Expression</Label>
          <Input
            id="cron-expression"
            value={data.cronExpression || ""}
            onChange={(e) => onUpdate({ cronExpression: e.target.value })}
            placeholder="*/5 * * * *"
            className="font-mono text-sm"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Format: minute hour day-of-month month day-of-week
          </p>
        </div>
      )}

      <div>
        <Label htmlFor="timezone">Timezone</Label>
        <Input
          id="timezone"
          value={data.timezone || ""}
          onChange={(e) => onUpdate({ timezone: e.target.value })}
          placeholder="UTC"
        />
      </div>

      <div>
        <Label htmlFor="max-executions">Max Executions</Label>
        <Input
          id="max-executions"
          type="number"
          min={0}
          value={data.maxExecutions ?? ""}
          onChange={(e) => {
            const val = e.target.value
            onUpdate({ maxExecutions: val === "" ? undefined : parseInt(val, 10) })
          }}
          placeholder="Unlimited"
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Leave empty for unlimited executions.
        </p>
      </div>
    </div>
  )
}
