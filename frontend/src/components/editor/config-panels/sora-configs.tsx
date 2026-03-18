"use client"

import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { SoraCharacterData } from "@/types/nodes"

export function SoraCharacterConfig({ data, onUpdate }: { data: SoraCharacterData; onUpdate: (updates: Record<string, unknown>) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs font-medium">Extraction Mode</Label>
        <Select value={data.mode} onValueChange={(v) => onUpdate({ mode: v as "video" | "sora-task" })}>
          <SelectTrigger className="mt-1.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="video">From Video</SelectItem>
            <SelectItem value="sora-task">From Sora Generation</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-xs font-medium">Character Description</Label>
        <Textarea
          className="mt-1.5"
          value={data.characterPrompt}
          onChange={(e) => onUpdate({ characterPrompt: e.target.value })}
          placeholder="Describe the character to extract..."
          maxLength={5000}
          rows={4}
        />
      </div>

      {data.mode === "sora-task" && (
        <>
          <div>
            <Label className="text-xs font-medium">Character Name</Label>
            <Input
              className="mt-1.5"
              value={data.characterName ?? ""}
              onChange={(e) => onUpdate({ characterName: e.target.value })}
              placeholder="my_character"
              maxLength={40}
            />
          </div>
          <div>
            <Label className="text-xs font-medium">Timestamp Range (start,end)</Label>
            <Input
              className="mt-1.5"
              value={data.timestamps ?? ""}
              onChange={(e) => onUpdate({ timestamps: e.target.value })}
              placeholder="3.55,5.55"
            />
            <p className="text-xs text-muted-foreground mt-1">1-4 second segment from the source video</p>
          </div>
        </>
      )}

      {data.mode === "video" && (
        <div>
          <Label className="text-xs font-medium">Safety Instruction (optional)</Label>
          <Input
            className="mt-1.5"
            value={data.safetyInstruction ?? ""}
            onChange={(e) => onUpdate({ safetyInstruction: e.target.value })}
            placeholder="Family-friendly content only"
          />
        </div>
      )}

      {data.generatedCharacterId && (
        <div className="rounded-md bg-muted p-3">
          <Label className="text-xs text-muted-foreground">Character ID</Label>
          <p className="text-sm font-mono break-all mt-1">{data.generatedCharacterId}</p>
        </div>
      )}
    </div>
  )
}
