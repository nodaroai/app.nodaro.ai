"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  CombineTextNodeData,
  SaveToStorageData,
  WebhookOutputData,
  SplitTextData,
} from "@/types/nodes"
import type { ConfigProps } from "./types"

const SEPARATOR_OPTIONS = [
  { value: "newline", label: "New Line (\\n)" },
  { value: "double-newline", label: "Double New Line (\\n\\n)" },
  { value: "comma", label: "Comma (,)" },
  { value: "space", label: "Space" },
  { value: "custom", label: "Custom" },
] as const

export function CombineTextConfig({ data, onUpdate }: { data: CombineTextNodeData; onUpdate: (patch: Partial<CombineTextNodeData>) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Separator</Label>
        <Select value={data.separator} onValueChange={(v) => onUpdate({ separator: v as CombineTextNodeData["separator"] })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {SEPARATOR_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {data.separator === "custom" && (
        <div>
          <Label>Custom Separator</Label>
          <Input value={data.customSeparator} onChange={(e) => onUpdate({ customSeparator: e.target.value })} placeholder="Enter separator..." />
        </div>
      )}

      {data.combinedText && (
        <div>
          <Label>Output Preview</Label>
          <Textarea rows={4} value={data.combinedText} readOnly className="text-xs opacity-70" />
        </div>
      )}
    </div>
  )
}

export function SaveToStorageConfig({ data, onUpdate }: ConfigProps<SaveToStorageData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="filename">Filename</Label>
        <Input id="filename" value={data.filename} onChange={(e) => onUpdate({ filename: e.target.value })} placeholder="output_video" />
      </div>
      <div>
        <Label>Format</Label>
        <Select value={data.format} onValueChange={(v) => onUpdate({ format: v as SaveToStorageData["format"] })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="mp4">MP4</SelectItem>
            <SelectItem value="webm">WebM</SelectItem>
            <SelectItem value="mov">MOV</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Quality</Label>
        <Select value={data.quality} onValueChange={(v) => onUpdate({ quality: v as SaveToStorageData["quality"] })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="standard">Standard</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="4k">4K</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

export function WebhookOutputConfig({ data, onUpdate }: ConfigProps<WebhookOutputData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="webhook-id">Webhook ID</Label>
        <Input id="webhook-id" value={data.webhookId} onChange={(e) => onUpdate({ webhookId: e.target.value })} placeholder="Select or enter webhook..." />
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="include-asset" checked={data.includeAssetUrl} onChange={(e) => onUpdate({ includeAssetUrl: e.target.checked })} />
        <Label htmlFor="include-asset">Include asset URL</Label>
      </div>
    </div>
  )
}

export function SplitTextConfig({ data, onUpdate }: { data: SplitTextData; onUpdate: (patch: Partial<SplitTextData>) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Separator</Label>
        <Input value={data.separator} onChange={(e) => onUpdate({ separator: e.target.value })} placeholder="Enter separator (e.g. * or ===NEXT===)" />
        <p className="text-[10px] text-muted-foreground mt-1">
          The delimiter used to split the input text into items
        </p>
      </div>

      <div className="flex items-center justify-between">
        <Label>Trim whitespace</Label>
        <Button
          variant={data.trimWhitespace !== false ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs"
          onClick={() => onUpdate({ trimWhitespace: data.trimWhitespace === false })}
        >
          {data.trimWhitespace !== false ? "On" : "Off"}
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <Label>Remove empty</Label>
        <Button
          variant={data.removeEmpty !== false ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs"
          onClick={() => onUpdate({ removeEmpty: data.removeEmpty === false })}
        >
          {data.removeEmpty !== false ? "On" : "Off"}
        </Button>
      </div>

      {data.splitResults && data.splitResults.length > 0 && (
        <div>
          <Label>Preview ({data.splitResults.length} items)</Label>
          <Textarea
            rows={Math.min(data.splitResults.length, 6)}
            value={data.splitResults.map((item, i) => `${i + 1}. ${item}`).join("\n")}
            readOnly
            className="text-xs opacity-70"
          />
        </div>
      )}
    </div>
  )
}
