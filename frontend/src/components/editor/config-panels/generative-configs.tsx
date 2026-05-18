"use client"

import { useState } from "react"
import type { GenerativePipelineNodeData } from "@/types/nodes"
import {
  PIPELINE_FORMATS,
  PIPELINE_OUTPUT_RESOLUTIONS,
  validateDurationForFormat,
  type PipelineFormat,
} from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { pipelinesApi } from "@/lib/pipelines-api"
import type { ConfigProps } from "./types"

export function GenerativePipelineConfig({ data, onUpdate }: ConfigProps<GenerativePipelineNodeData>) {
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const format: PipelineFormat = data.format ?? "short_film"
  const duration = data.target_duration_seconds ?? 60
  const validation = validateDurationForFormat(format, duration)

  async function handleRun() {
    if (!selectedNodeId) {
      setErr("No node selected")
      return
    }
    if (!validation.ok) {
      setErr(validation.reason)
      return
    }
    if (!data.story_prompt || data.story_prompt.length < 1) {
      setErr("Story prompt required")
      return
    }
    setRunning(true)
    setErr(null)
    try {
      const { id } = await pipelinesApi.create({
        pipeline_type: "story_to_video",
        root_node_id: selectedNodeId,
        story_prompt: data.story_prompt,
        target_duration_seconds: duration,
        format,
        output_resolution: data.output_resolution ?? "1080p",
        language: "en",
        mode: data.mode ?? "manual",
      })
      onUpdate({ pipeline_id: id, status: "queued" })
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to start pipeline")
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="story_prompt">Story prompt</Label>
        <Textarea
          id="story_prompt"
          value={data.story_prompt ?? ""}
          onChange={(e) => onUpdate({ story_prompt: e.target.value })}
          rows={6}
          maxLength={4000}
          placeholder="A fighter pilot's final mission over the desert..."
        />
      </div>
      <div>
        <Label htmlFor="target_duration_seconds">Target duration (seconds)</Label>
        <Input
          id="target_duration_seconds"
          type="number"
          value={duration}
          min={5}
          max={600}
          onChange={(e) => onUpdate({ target_duration_seconds: Number(e.target.value) })}
        />
        {!validation.ok && (
          <div className="mt-1 text-xs text-red-600">{validation.reason}</div>
        )}
      </div>
      <div>
        <Label>Format</Label>
        <Select
          value={format}
          onValueChange={(v) => onUpdate({ format: v as PipelineFormat })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PIPELINE_FORMATS.map((f) => (
              <SelectItem key={f} value={f}>
                {f.replace("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Output resolution</Label>
        <Select
          value={data.output_resolution ?? "1080p"}
          onValueChange={(v) => onUpdate({ output_resolution: v as "720p" | "1080p" | "4K" })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PIPELINE_OUTPUT_RESOLUTIONS.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button onClick={handleRun} disabled={running || !validation.ok}>
        {running ? "Starting..." : data.pipeline_id ? "Re-run" : "Run pipeline"}
      </Button>
      {err && <div className="text-xs text-red-600">{err}</div>}
    </div>
  )
}
