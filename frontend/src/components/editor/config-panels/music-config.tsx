"use client"

import { useState, useCallback, useMemo } from "react"
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
import { CachedImage } from "@/components/ui/cached-image"
import { uploadAudio, downloadYouTubeAudio } from "@/lib/api"
import type { GenerateMusicData } from "@/types/nodes"
import { MappableField } from "./mappable-field"
import { PromptHelperButton } from "./prompt-helper-button"
import type { ConfigProps } from "./types"

export function GenerateMusicConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<GenerateMusicData>) {
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "error">("idle")
  const [ytStatus, setYtStatus] = useState<"idle" | "downloading" | "error">("idle")

  const connectedRef = sources.find((s) => s.targetHandle === "ref-audio")

  const handleFileUpload = useCallback(async (file: File) => {
    setUploadStatus("uploading")
    try {
      const result = await uploadAudio(file)
      onUpdate({ referenceAudioUrl: result.url, referenceSource: "upload" })
      setUploadStatus("idle")
    } catch {
      setUploadStatus("error")
    }
  }, [onUpdate])

  const handleYouTubeDownload = useCallback(async () => {
    const url = data.referenceYouTubeUrl?.trim()
    if (!url) return
    setYtStatus("downloading")
    try {
      const result = await downloadYouTubeAudio(url)
      onUpdate({ referenceAudioUrl: result.url, referenceSource: "youtube" })
      setYtStatus("idle")
    } catch {
      setYtStatus("error")
    }
  }, [data.referenceYouTubeUrl, onUpdate])

  const isMinimax = data.provider === "minimax"
  const hasReference = Boolean(data.referenceAudioUrl) || Boolean(connectedRef)

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Provider</Label>
        <Select
          value={data.provider || "suno"}
          onValueChange={(v) => onUpdate({ provider: v as GenerateMusicData["provider"], referenceSource: "none", referenceAudioUrl: "", referenceYouTubeUrl: "" })}
        >
          <SelectTrigger aria-label="Provider"><SelectValue /></SelectTrigger>
          <SelectContent>
            {/* Replicate disabled */}
            {/* <SelectItem value="musicgen">MusicGen (Meta) - instrumental (default)</SelectItem> */}
            <SelectItem value="minimax">MiniMax Music - vocals & lyrics</SelectItem>
            {/* Replicate disabled */}
            {/* <SelectItem value="lyria">Lyria 2 (Google) - high quality</SelectItem> */}
            {/* <SelectItem value="bark">Bark (Suno) - speech & music</SelectItem> */}
          </SelectContent>
        </Select>
      </div>
      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<PromptHelperButton nodeType="generate-music" currentPrompt={data.prompt || ""} provider={data.provider} onAccept={(prompt, modelChange) => onUpdate({ prompt, ...(modelChange && { [modelChange.field]: modelChange.value }) })} />}>
        <Textarea
          id="music-prompt"
          value={data.prompt}
          onChange={(e) => onUpdate({ prompt: e.target.value })}
          placeholder="Describe the music you want... (use {} to inject input)"
          rows={3}
        />
      </MappableField>
      {/* Replicate disabled: was musicgen/lyria/!provider, now just non-minimax */}
      {!isMinimax && (
        <div>
          <Label htmlFor="music-duration">Duration (seconds)</Label>
          <Input
            id="music-duration"
            type="number"
            min={1}
            max={30}
            value={data.duration ?? ""}
            onChange={(e) => onUpdate({ duration: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
          />
        </div>
      )}
      {isMinimax && (
        <MappableField field="lyrics" label="Lyrics" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <Textarea
            id="music-lyrics"
            value={data.lyrics || ""}
            onChange={(e) => onUpdate({ lyrics: e.target.value })}
            placeholder="Write lyrics for the song... (use {} to inject input)"
            rows={4}
          />
        </MappableField>
      )}
      {isMinimax && (
        <div className="flex flex-col gap-2">
          <Label>Reference Audio</Label>
          {connectedRef ? (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs flex flex-col gap-1.5">
              <div>
                <span className="text-muted-foreground">From: </span>
                <span className="font-medium">{connectedRef.label}</span>
              </div>
              {typeof connectedRef.nodeData?.videoThumbnail === "string" && connectedRef.nodeData.videoThumbnail && (
                <div className="rounded overflow-hidden bg-muted">
                  <CachedImage src={connectedRef.nodeData.videoThumbnail} alt="" className="w-full h-16 object-cover" thumbnail thumbnailWidth={320} />
                </div>
              )}
              {typeof connectedRef.nodeData?.videoTitle === "string" && connectedRef.nodeData.videoTitle && (
                <p className="text-foreground truncate">{connectedRef.nodeData.videoTitle}</p>
              )}
              {connectedRef.nodeData?.extractedAudioUrl ? (
                <p className="text-green-600">Audio ready</p>
              ) : (
                <p className="text-amber-500">No audio extracted yet</p>
              )}
            </div>
          ) : (
          <>
          {!hasReference && (
            <p className="text-xs text-amber-500">MiniMax works best with a reference song</p>
          )}
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="radio" name="ref-source" checked={data.referenceSource === "none" || !data.referenceSource} onChange={() => onUpdate({ referenceSource: "none", referenceAudioUrl: "" })} />
              None
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="radio" name="ref-source" checked={data.referenceSource === "upload"} onChange={() => onUpdate({ referenceSource: "upload" })} />
              Upload file
            </label>
            {data.referenceSource === "upload" && (
              <div className="ml-6 flex flex-col gap-1">
                <Input
                  type="file"
                  accept="audio/mpeg,audio/wav,audio/mp4,audio/aac,.mp3,.wav,.m4a,.aac"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleFileUpload(file)
                  }}
                />
                {uploadStatus === "uploading" && <p className="text-xs text-muted-foreground">Uploading...</p>}
                {uploadStatus === "error" && <p className="text-xs text-red-500">Upload failed</p>}
                {data.referenceSource === "upload" && hasReference && <p className="text-xs text-green-600">Uploaded</p>}
              </div>
            )}
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="radio" name="ref-source" checked={data.referenceSource === "youtube"} onChange={() => onUpdate({ referenceSource: "youtube" })} />
              YouTube URL
            </label>
            {data.referenceSource === "youtube" && (
              <div className="ml-6 flex flex-col gap-1">
                <div className="flex gap-1">
                  <Input
                    value={data.referenceYouTubeUrl || ""}
                    onChange={(e) => onUpdate({ referenceYouTubeUrl: e.target.value })}
                    placeholder="https://youtube.com/watch?v=..."
                    className="flex-1"
                  />
                  <Button size="sm" variant="outline" onClick={handleYouTubeDownload} disabled={ytStatus === "downloading" || !data.referenceYouTubeUrl?.trim()}>
                    {ytStatus === "downloading" ? "..." : "Get"}
                  </Button>
                </div>
                {ytStatus === "downloading" && <p className="text-xs text-muted-foreground">Downloading audio...</p>}
                {ytStatus === "error" && <p className="text-xs text-red-500">Download failed</p>}
                {data.referenceSource === "youtube" && hasReference && <p className="text-xs text-green-600">Ready</p>}
              </div>
            )}
          </div>
          </>
          )}
        </div>
      )}
      <MappableField field="genre" label="Genre" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input id="music-genre" value={data.genre} onChange={(e) => onUpdate({ genre: e.target.value })} placeholder="e.g. rock, jazz, electronic (use {} to inject input)" />
      </MappableField>
      <MappableField field="mood" label="Mood" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input id="music-mood" value={data.mood} onChange={(e) => onUpdate({ mood: e.target.value })} placeholder="e.g. upbeat, melancholic, epic (use {} to inject input)" />
      </MappableField>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="music-instrumental" checked={data.instrumental} onChange={(e) => onUpdate({ instrumental: e.target.checked })} className="h-4 w-4" />
        <Label htmlFor="music-instrumental">Instrumental (no vocals)</Label>
      </div>
    </div>
  )
}
