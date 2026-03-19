"use client"

import { useState } from "react"
import { Copy, Check, Plus, Trash2 } from "lucide-react"
import { nanoid } from "nanoid"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { WebhookParam, TelegramTriggerData } from "@/types/nodes"
import type { ConfigProps } from "./types"
import { useSocialConnections } from "./social-configs"

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
          <span className="font-mono">{data.webhookToken!.slice(0, 8)}{"••••••••"}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 text-[10px] ml-2 px-1.5"
            onClick={() => navigator.clipboard.writeText(data.webhookToken!)}
          >
            Copy
          </Button>
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

// ── Telegram Trigger ────────────────────────────────────────────

const TELEGRAM_MESSAGE_TYPES = [
  { value: "text", label: "Text" },
  { value: "photo", label: "Photo" },
  { value: "video", label: "Video" },
  { value: "audio", label: "Audio" },
  { value: "document", label: "Document" },
]

const DEFAULT_MESSAGE_TYPE_FILTERS = TELEGRAM_MESSAGE_TYPES.map((t) => t.value)

export function TelegramTriggerConfig({ data, onUpdate }: ConfigProps<TelegramTriggerData>) {
  const d = data as TelegramTriggerData
  const { connections, loading: loadingConnections } = useSocialConnections("telegram")

  const selectedFilters: string[] = d.messageTypeFilters ?? DEFAULT_MESSAGE_TYPE_FILTERS

  const toggleMessageType = (value: string, checked: boolean) => {
    const next = checked
      ? [...selectedFilters, value]
      : selectedFilters.filter((v) => v !== value)
    onUpdate({ messageTypeFilters: next })
  }

  const isActive = d.isActive ?? false

  const handleToggleActive = () => {
    onUpdate({ isActive: !isActive })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Status indicator */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium ${
        isActive
          ? "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400"
          : "bg-gray-50 dark:bg-[#2D2D2D] border-gray-200 dark:border-[#2D2D2D] text-gray-500 dark:text-[#64748B]"
      }`}>
        <div className={`h-2 w-2 rounded-full ${isActive ? "bg-green-500" : "bg-gray-400"}`} />
        {isActive ? "Active — listening for messages" : "Inactive"}
      </div>

      {/* Connection selector */}
      <div>
        <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">Telegram Bot</Label>
        {!loadingConnections && connections.length === 0 ? (
          <p className="text-xs text-muted-foreground mt-1.5 p-2 bg-muted/30 rounded-md border border-dashed border-border">
            No Telegram bot connected.{" "}
            <a href="/integrations" className="underline">Connect in Integrations</a>.
          </p>
        ) : (
          <Select
            value={d.connectionId || ""}
            onValueChange={(v) => onUpdate({ connectionId: v })}
          >
            <SelectTrigger className="mt-1.5">
              <SelectValue placeholder="Select bot..." />
            </SelectTrigger>
            <SelectContent>
              {connections.map((conn) => (
                <SelectItem key={conn.id} value={conn.id}>
                  {conn.display_name || conn.platform_username || "Telegram Bot"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Chat ID filter */}
      <div>
        <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">Chat ID Filter</Label>
        <Input
          value={d.chatIdFilter || ""}
          onChange={(e) => onUpdate({ chatIdFilter: e.target.value })}
          placeholder="Optional — leave blank to receive from all chats"
          className="mt-1.5"
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Restrict to a specific chat ID (e.g. @channel or -100xxx).
        </p>
      </div>

      {/* Message type filters */}
      <div>
        <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">Message Types</Label>
        <div className="flex flex-col gap-2 mt-2">
          {TELEGRAM_MESSAGE_TYPES.map((type) => (
            <div key={type.value} className="flex items-center gap-2">
              <Checkbox
                id={`msg-type-${type.value}`}
                checked={selectedFilters.includes(type.value)}
                onCheckedChange={(checked) => toggleMessageType(type.value, !!checked)}
              />
              <label htmlFor={`msg-type-${type.value}`} className="text-sm cursor-pointer">
                {type.label}
              </label>
            </div>
          ))}
        </div>
      </div>

      {/* Activate / Deactivate */}
      <Button
        variant={isActive ? "outline" : "default"}
        className={isActive ? "w-full border-destructive/30 text-destructive hover:bg-destructive/10" : "w-full bg-[#ff0073] hover:bg-[#e0005f] text-white"}
        onClick={handleToggleActive}
      >
        {isActive ? "Deactivate Trigger" : "Activate Trigger"}
      </Button>
    </div>
  )
}
