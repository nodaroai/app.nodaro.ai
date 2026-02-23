"use client"

import { useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TTS_VOICES } from "@/lib/tts-voices"
import type {
  TextToSpeechData,
  TextToAudioData,
  AudioIsolationData,
  SunoGenerateData,
  SunoCoverData,
  SunoExtendData,
  SunoLyricsData,
  SunoSeparateData,
  SunoMusicVideoData,
  TranscribeData,
  LipSyncData,
  TextToDialogueData,
  DialogueLine,
} from "@/types/nodes"
import { MappableField } from "./mappable-field"
import type { ConfigProps } from "./types"

export function TextToSpeechConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<TextToSpeechData>) {
  const textSource = data.textSource || "connected"
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Text Source</Label>
        <div className="flex gap-2 mt-1">
          <button
            type="button"
            onClick={() => onUpdate({ textSource: "connected" })}
            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${textSource === "connected" ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`}
          >
            From connected node
          </button>
          <button
            type="button"
            onClick={() => onUpdate({ textSource: "direct" })}
            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${textSource === "direct" ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`}
          >
            Write directly
          </button>
        </div>
      </div>
      {textSource === "direct" && (
        <div>
          <Label>Text</Label>
          <Textarea
            rows={4}
            value={data.directText || ""}
            onChange={(e) => onUpdate({ directText: e.target.value })}
            placeholder="Enter text to convert to speech..."
          />
        </div>
      )}
      <MappableField field="provider" label="Model" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="voice">
        <Select
          value={data.provider === "elevenlabs" ? "elevenlabs-turbo" : (data.provider || "elevenlabs-turbo")}
          onValueChange={(v) => onUpdate({ provider: v as TextToSpeechData["provider"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="elevenlabs-turbo">ElevenLabs Turbo v2.5 (fast)</SelectItem>
            <SelectItem value="elevenlabs-multilingual">ElevenLabs Multilingual v2</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <div>
        <Label>Voice</Label>
        <Select
          value={data.voiceId || "Rachel"}
          onValueChange={(v) => onUpdate({ voiceId: v })}
        >
          <SelectTrigger><SelectValue placeholder="Select voice" /></SelectTrigger>
          <SelectContent>
            {TTS_VOICES.map((voice) => (
              <SelectItem key={voice.id} value={voice.id}>
                {voice.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Language</Label>
        <Select
          value={data.languageCode || "auto"}
          onValueChange={(v) => onUpdate({ languageCode: v === "auto" ? "" : v })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto-detect</SelectItem>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="he">Hebrew</SelectItem>
            <SelectItem value="es">Spanish</SelectItem>
            <SelectItem value="fr">French</SelectItem>
            <SelectItem value="de">German</SelectItem>
            <SelectItem value="it">Italian</SelectItem>
            <SelectItem value="pt">Portuguese</SelectItem>
            <SelectItem value="ja">Japanese</SelectItem>
            <SelectItem value="zh">Chinese</SelectItem>
            <SelectItem value="ko">Korean</SelectItem>
            <SelectItem value="ar">Arabic</SelectItem>
            <SelectItem value="ru">Russian</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="stability">Stability ({data.stability ?? 0.5})</Label>
        <Input id="stability" type="range" min={0} max={1} step={0.05} value={data.stability ?? 0.5} onChange={(e) => onUpdate({ stability: parseFloat(e.target.value) })} className="h-2" />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>Variable</span><span>Stable</span></div>
      </div>
      <div>
        <Label htmlFor="similarityBoost">Similarity ({data.similarityBoost ?? 0.75})</Label>
        <Input id="similarityBoost" type="range" min={0} max={1} step={0.05} value={data.similarityBoost ?? 0.75} onChange={(e) => onUpdate({ similarityBoost: parseFloat(e.target.value) })} className="h-2" />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>Low</span><span>High</span></div>
      </div>
      <div>
        <Label htmlFor="style">Style Exaggeration ({data.style ?? 0})</Label>
        <Input id="style" type="range" min={0} max={1} step={0.05} value={data.style ?? 0} onChange={(e) => onUpdate({ style: parseFloat(e.target.value) })} className="h-2" />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>None</span><span>Exaggerated</span></div>
      </div>
      <div>
        <Label htmlFor="speed">Speed ({data.speed ?? 1})</Label>
        <Input id="speed" type="range" min={0.7} max={1.2} step={0.05} value={data.speed ?? 1} onChange={(e) => onUpdate({ speed: parseFloat(e.target.value) })} className="h-2" />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>0.7x</span><span>1.2x</span></div>
      </div>
    </div>
  )
}

export function TextToAudioConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<TextToAudioData>) {
  const isSfx = data.provider === "elevenlabs-sfx"
  const maxPromptLen = isSfx ? 450 : 2000
  const minDuration = isSfx ? 0.5 : 1
  const maxDuration = isSfx ? 22 : 30

  return (
    <div className="flex flex-col gap-3">
      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea
          rows={3}
          value={data.prompt}
          onChange={(e) => {
            const v = e.target.value
            if (v.length <= maxPromptLen) onUpdate({ prompt: v })
          }}
          placeholder={isSfx ? "Describe the sound effect (max 450 chars)..." : "Describe the sound effect (e.g. dog barking, rain on window)..."}
        />
        {isSfx && (
          <p className="text-xs text-muted-foreground mt-1">{data.prompt.length}/{maxPromptLen}</p>
        )}
      </MappableField>
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.provider || "tangoflux"}
          onValueChange={(v) => onUpdate({ provider: v as TextToAudioData["provider"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="tangoflux">TangoFlux (default)</SelectItem>
            <SelectItem value="elevenlabs-sfx">ElevenLabs SFX v2</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="duration" label="Duration (seconds)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input
          type="number"
          min={minDuration}
          max={maxDuration}
          step={isSfx ? 0.5 : 1}
          value={data.duration}
          onChange={(e) => onUpdate({ duration: parseFloat(e.target.value) || 10 })}
        />
      </MappableField>
      {isSfx && (
        <>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Loop</label>
            <Select value={data.loop ? "true" : "false"} onValueChange={(v) => onUpdate({ loop: v === "true" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="false">Off</SelectItem>
                <SelectItem value="true">On (seamless loop)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">Prompt Influence</label>
              <span className="text-xs text-muted-foreground">{(data.promptInfluence ?? 0.3).toFixed(1)}</span>
            </div>
            <input
              type="range" min={0} max={1} step={0.1}
              value={data.promptInfluence ?? 0.3}
              onChange={(e) => onUpdate({ promptInfluence: parseFloat(e.target.value) })}
              className="w-full accent-[#ff0073]"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground"><span>More random</span><span>More faithful</span></div>
          </div>
        </>
      )}
    </div>
  )
}

export function SunoGenerateConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<SunoGenerateData>) {
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea rows={3} value={data.prompt} onChange={(e) => { const v = e.target.value; if (v.length <= 3000) onUpdate({ prompt: v }) }} placeholder="Describe the song you want to generate..." />
        <p className="text-xs text-muted-foreground mt-1">{data.prompt.length}/3000</p>
      </MappableField>
      <MappableField field="model" label="Model" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.model || "V5"} onValueChange={(v) => onUpdate({ model: v as SunoGenerateData["model"] })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="V5">Suno V5 (latest)</SelectItem>
            <SelectItem value="V4_5ALL">Suno V4.5 All</SelectItem>
            <SelectItem value="V4_5PLUS">Suno V4.5 Plus</SelectItem>
            <SelectItem value="V4_5">Suno V4.5</SelectItem>
            <SelectItem value="V4">Suno V4</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="title" label="Title (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.title ?? ""} maxLength={200} onChange={(e) => onUpdate({ title: e.target.value })} placeholder="Song title" />
      </MappableField>
      <MappableField field="lyrics" label="Lyrics (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea rows={4} value={data.lyrics ?? ""} onChange={(e) => { const v = e.target.value; if (v.length <= 3000) onUpdate({ lyrics: v }) }} placeholder="Write custom lyrics..." />
      </MappableField>
      <MappableField field="style" label="Style (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.style ?? ""} maxLength={500} onChange={(e) => onUpdate({ style: e.target.value })} placeholder="e.g. pop, rock, jazz, lo-fi..." />
      </MappableField>
      <MappableField field="negativeStyle" label="Negative Style (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.negativeStyle ?? ""} maxLength={500} onChange={(e) => onUpdate({ negativeStyle: e.target.value })} placeholder="Styles to avoid..." />
      </MappableField>
      <MappableField field="vocalGender" label="Vocal Gender (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.vocalGender ?? "auto"} onValueChange={(v) => onUpdate({ vocalGender: v === "auto" ? undefined : v })}>
          <SelectTrigger><SelectValue placeholder="Auto" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto</SelectItem>
            <SelectItem value="male">Male</SelectItem>
            <SelectItem value="female">Female</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between"><label className="text-xs font-medium text-muted-foreground">Style Weight</label><span className="text-xs text-muted-foreground">{data.styleWeight ?? 50}</span></div>
        <input type="range" min={0} max={100} step={1} value={data.styleWeight ?? 50} onChange={(e) => onUpdate({ styleWeight: parseInt(e.target.value) })} className="w-full accent-[#ff0073]" />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between"><label className="text-xs font-medium text-muted-foreground">Weirdness</label><span className="text-xs text-muted-foreground">{data.weirdnessConstraint ?? 0}</span></div>
        <input type="range" min={0} max={100} step={1} value={data.weirdnessConstraint ?? 0} onChange={(e) => onUpdate({ weirdnessConstraint: parseInt(e.target.value) })} className="w-full accent-[#ff0073]" />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between"><label className="text-xs font-medium text-muted-foreground">Audio Weight</label><span className="text-xs text-muted-foreground">{data.audioWeight ?? 50}</span></div>
        <input type="range" min={0} max={100} step={1} value={data.audioWeight ?? 50} onChange={(e) => onUpdate({ audioWeight: parseInt(e.target.value) })} className="w-full accent-[#ff0073]" />
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="suno-instrumental" checked={data.instrumental ?? false} onChange={(e) => onUpdate({ instrumental: e.target.checked })} className="accent-[#ff0073]" />
        <label htmlFor="suno-instrumental" className="text-xs font-medium text-muted-foreground">Instrumental (no vocals)</label>
      </div>
    </div>
  )
}

export function SunoCoverConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<SunoCoverData>) {
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea rows={3} value={data.prompt} onChange={(e) => { const v = e.target.value; if (v.length <= 3000) onUpdate({ prompt: v }) }} placeholder="Describe the cover style..." />
        <p className="text-xs text-muted-foreground mt-1">{data.prompt.length}/3000</p>
      </MappableField>
      <MappableField field="uploadUrl" label="Source Audio URL" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.uploadUrl ?? ""} onChange={(e) => onUpdate({ uploadUrl: e.target.value })} placeholder="URL of the audio to cover (or connect an audio node)" />
      </MappableField>
      <MappableField field="model" label="Model" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.model || "V5"} onValueChange={(v) => onUpdate({ model: v as SunoCoverData["model"] })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="V5">Suno V5 (latest)</SelectItem>
            <SelectItem value="V4_5ALL">Suno V4.5 All</SelectItem>
            <SelectItem value="V4_5PLUS">Suno V4.5 Plus</SelectItem>
            <SelectItem value="V4_5">Suno V4.5</SelectItem>
            <SelectItem value="V4">Suno V4</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="title" label="Title (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.title ?? ""} maxLength={200} onChange={(e) => onUpdate({ title: e.target.value })} placeholder="Cover title" />
      </MappableField>
      <MappableField field="lyrics" label="Lyrics (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea rows={4} value={data.lyrics ?? ""} onChange={(e) => { const v = e.target.value; if (v.length <= 3000) onUpdate({ lyrics: v }) }} placeholder="Write custom lyrics for the cover..." />
      </MappableField>
      <MappableField field="style" label="Style (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.style ?? ""} maxLength={500} onChange={(e) => onUpdate({ style: e.target.value })} placeholder="e.g. pop, rock, jazz, lo-fi..." />
      </MappableField>
      <MappableField field="negativeStyle" label="Negative Style (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.negativeStyle ?? ""} maxLength={500} onChange={(e) => onUpdate({ negativeStyle: e.target.value })} placeholder="Styles to avoid..." />
      </MappableField>
      <MappableField field="vocalGender" label="Vocal Gender (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.vocalGender ?? "auto"} onValueChange={(v) => onUpdate({ vocalGender: v === "auto" ? undefined : v })}>
          <SelectTrigger><SelectValue placeholder="Auto" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto</SelectItem>
            <SelectItem value="male">Male</SelectItem>
            <SelectItem value="female">Female</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="suno-cover-instrumental" checked={data.instrumental ?? false} onChange={(e) => onUpdate({ instrumental: e.target.checked })} className="accent-[#ff0073]" />
        <label htmlFor="suno-cover-instrumental" className="text-xs font-medium text-muted-foreground">Instrumental (no vocals)</label>
      </div>
    </div>
  )
}

export function SunoExtendConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<SunoExtendData>) {
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="audioId" label="Audio ID (from Suno node)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.audioId ?? ""} onChange={(e) => onUpdate({ audioId: e.target.value })} placeholder="Suno track ID (auto-filled from connected node)" />
      </MappableField>
      <MappableField field="continueAt" label="Continue From (seconds)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input type="number" min={0} value={data.continueAt ?? 0} onChange={(e) => onUpdate({ continueAt: Number(e.target.value) })} placeholder="0" />
      </MappableField>
      <MappableField field="prompt" label="Extension Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea rows={3} value={data.prompt ?? ""} onChange={(e) => { const v = e.target.value; if (v.length <= 5000) onUpdate({ prompt: v }) }} placeholder="Describe how the music should continue..." />
        <p className="text-xs text-muted-foreground mt-1">{(data.prompt ?? "").length}/5000</p>
      </MappableField>
      <MappableField field="model" label="Model" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.model || "V5"} onValueChange={(v) => onUpdate({ model: v as SunoExtendData["model"] })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="V5">Suno V5 (latest)</SelectItem>
            <SelectItem value="V4_5ALL">Suno V4.5 All</SelectItem>
            <SelectItem value="V4_5PLUS">Suno V4.5 Plus</SelectItem>
            <SelectItem value="V4_5">Suno V4.5</SelectItem>
            <SelectItem value="V4">Suno V4</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="title" label="Title (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.title ?? ""} maxLength={80} onChange={(e) => onUpdate({ title: e.target.value })} placeholder="Extended track title" />
      </MappableField>
      <MappableField field="style" label="Style (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.style ?? ""} maxLength={1000} onChange={(e) => onUpdate({ style: e.target.value })} placeholder="e.g. pop, rock, jazz..." />
      </MappableField>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="suno-extend-customParams" checked={data.defaultParamFlag ?? true} onChange={(e) => onUpdate({ defaultParamFlag: e.target.checked })} className="accent-[#ff0073]" />
        <label htmlFor="suno-extend-customParams" className="text-xs font-medium text-muted-foreground">Use default parameters (uncheck to customize)</label>
      </div>
    </div>
  )
}

export function SunoLyricsConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<SunoLyricsData>) {
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea rows={3} value={data.prompt} onChange={(e) => { const v = e.target.value; if (v.length <= 1000) onUpdate({ prompt: v }) }} placeholder="Describe the lyrics you want (theme, mood, style)..." />
        <p className="text-xs text-muted-foreground mt-1">{data.prompt.length}/1000</p>
      </MappableField>
      {data.generatedText && (
        <div className="rounded-md border bg-muted/30 p-2 text-xs max-h-40 overflow-y-auto whitespace-pre-wrap">
          {data.generatedTitle && <p className="font-medium mb-1">{data.generatedTitle}</p>}
          {data.generatedText}
        </div>
      )}
    </div>
  )
}

export function SunoSeparateConfig({ data, onUpdate }: { readonly data: SunoSeparateData; readonly onUpdate: (updates: Partial<SunoSeparateData>) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Separation Type</label>
        <Select value={data.type} onValueChange={(v) => onUpdate({ type: v as SunoSeparateData["type"] })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="separate_vocal">Vocal / Instrumental</SelectItem>
            <SelectItem value="split_stem">12 Stems</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Task ID</label>
        <Input value={data.taskId} onChange={(e) => onUpdate({ taskId: e.target.value })} placeholder="Suno task ID" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Audio ID</label>
        <Input value={data.audioId} onChange={(e) => onUpdate({ audioId: e.target.value })} placeholder="Suno audio ID" />
      </div>
      {data.vocalUrl && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Vocal</label>
          <audio src={data.vocalUrl} controls className="w-full h-8" preload="none" />
        </div>
      )}
      {data.instrumentalUrl && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Instrumental</label>
          <audio src={data.instrumentalUrl} controls className="w-full h-8" preload="none" />
        </div>
      )}
      {data.stems && Object.keys(data.stems).length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Stems</label>
          {Object.entries(data.stems).map(([name, url]) => (
            <div key={name} className="flex flex-col gap-0.5">
              <span className="text-[10px] text-muted-foreground capitalize">{name.replace(/_/g, " ")}</span>
              <audio src={url} controls className="w-full h-8" preload="none" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function SunoMusicVideoConfig({ data, onUpdate }: { readonly data: SunoMusicVideoData; readonly onUpdate: (updates: Partial<SunoMusicVideoData>) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Task ID</label>
        <Input value={data.taskId} onChange={(e) => onUpdate({ taskId: e.target.value })} placeholder="From upstream Suno node" />
        <p className="text-[10px] text-muted-foreground mt-1">Auto-filled when connected to a Suno node</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Audio ID</label>
        <Input value={data.audioId} onChange={(e) => onUpdate({ audioId: e.target.value })} placeholder="From upstream Suno node" />
        <p className="text-[10px] text-muted-foreground mt-1">Auto-filled when connected to a Suno node</p>
      </div>
      {data.generatedVideoUrl && (
        <div className="rounded-md border overflow-hidden">
          <video src={data.generatedVideoUrl} controls className="w-full" />
        </div>
      )}
    </div>
  )
}

export function TranscribeConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<TranscribeData>) {
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.provider || "whisper"} onValueChange={(v) => onUpdate({ provider: v as TranscribeData["provider"] })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="whisper">Whisper (default)</SelectItem>
            <SelectItem value="incredibly-fast-whisper">Incredibly Fast Whisper</SelectItem>
            <SelectItem value="elevenlabs-stt">ElevenLabs STT</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="language" label="Language" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.language || "auto"} onValueChange={(v) => onUpdate({ language: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto Detect</SelectItem>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="he">Hebrew</SelectItem>
            <SelectItem value="es">Spanish</SelectItem>
            <SelectItem value="fr">French</SelectItem>
            <SelectItem value="de">German</SelectItem>
            <SelectItem value="it">Italian</SelectItem>
            <SelectItem value="pt">Portuguese</SelectItem>
            <SelectItem value="ja">Japanese</SelectItem>
            <SelectItem value="zh">Chinese</SelectItem>
            <SelectItem value="ko">Korean</SelectItem>
            <SelectItem value="ar">Arabic</SelectItem>
            <SelectItem value="ru">Russian</SelectItem>
            <SelectItem value="hi">Hindi</SelectItem>
            <SelectItem value="nl">Dutch</SelectItem>
            <SelectItem value="tr">Turkish</SelectItem>
            <SelectItem value="pl">Polish</SelectItem>
            <SelectItem value="sv">Swedish</SelectItem>
            <SelectItem value="th">Thai</SelectItem>
            <SelectItem value="vi">Vietnamese</SelectItem>
            <SelectItem value="uk">Ukrainian</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      {data.provider === "elevenlabs-stt" && (
        <>
          <div className="flex items-center gap-2">
            <Checkbox
              id="diarize"
              checked={data.diarize ?? false}
              onCheckedChange={(v: boolean) => onUpdate({ diarize: v })}
            />
            <Label htmlFor="diarize">Speaker Diarization</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="tagAudioEvents"
              checked={data.tagAudioEvents ?? false}
              onCheckedChange={(v: boolean) => onUpdate({ tagAudioEvents: v })}
            />
            <Label htmlFor="tagAudioEvents">Tag Audio Events</Label>
          </div>
        </>
      )}
    </div>
  )
}

export function LipSyncConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<LipSyncData>) {
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.provider || "kling-avatar"} onValueChange={(v) => onUpdate({ provider: v as LipSyncData["provider"] })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="kling-avatar">Kling Avatar (40 credits)</SelectItem>
            <SelectItem value="kling-avatar-pro">Kling Avatar Pro (60 credits)</SelectItem>
            <SelectItem value="infinitalk">Infinitalk (60 credits)</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="resolution" label="Resolution" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.resolution || "720p"} onValueChange={(v) => onUpdate({ resolution: v as LipSyncData["resolution"] })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="480p">480p</SelectItem>
            <SelectItem value="720p">720p (default)</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="prompt" label="Motion Prompt (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea rows={2} value={data.prompt ?? ""} onChange={(e) => onUpdate({ prompt: e.target.value })} placeholder="Optional: describe head/expression motions..." />
      </MappableField>
      <p className="text-xs text-muted-foreground">
        Connect a portrait image and an audio track (speech/voiceover) to generate a talking head video.
      </p>
    </div>
  )
}

export function AudioIsolationConfig({ data, onUpdate }: ConfigProps<AudioIsolationData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Label</Label>
        <Input
          value={data.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="Voice Extractor"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Removes background noise and extracts clean voice from any audio input. Connect an audio source (Upload Audio, Text to Speech, etc.) to the input.
      </p>
    </div>
  )
}

export function TextToDialogueConfig({ data, onUpdate }: ConfigProps<TextToDialogueData>) {
  const dialogue = data.dialogue ?? [{ id: "1", text: "", voice: "Rachel" }]
  const totalChars = dialogue.reduce((sum, l) => sum + l.text.length, 0)

  function updateLine(index: number, updates: Partial<DialogueLine>) {
    const newDialogue = dialogue.map((line, i) =>
      i === index ? { ...line, ...updates } : line
    )
    onUpdate({ dialogue: newDialogue })
  }

  function addLine() {
    const newId = String(Date.now())
    onUpdate({ dialogue: [...dialogue, { id: newId, text: "", voice: "Rachel" }] })
  }

  function removeLine(index: number) {
    if (dialogue.length <= 1) return
    onUpdate({ dialogue: dialogue.filter((_, i) => i !== index) })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Label>Dialogue Lines</Label>
        <span className={`text-xs ${totalChars > 5000 ? "text-red-500" : "text-muted-foreground"}`}>
          {totalChars}/5000
        </span>
      </div>

      <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto">
        {dialogue.map((line, i) => (
          <div key={line.id} className="flex flex-col gap-1 p-2 rounded-md border border-border bg-muted/20">
            <div className="flex items-center gap-2">
              <Select value={line.voice} onValueChange={(v) => updateLine(i, { voice: v })}>
                <SelectTrigger className="w-[140px] h-8 text-xs">
                  <SelectValue placeholder="Voice" />
                </SelectTrigger>
                <SelectContent>
                  {TTS_VOICES.map((voice) => (
                    <SelectItem key={voice.id} value={voice.id}>
                      {voice.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {dialogue.length > 1 && (
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeLine(i)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
            <Textarea
              rows={2}
              value={line.text}
              onChange={(e) => updateLine(i, { text: e.target.value })}
              placeholder={`Line ${i + 1}...`}
              className="text-sm"
            />
          </div>
        ))}
      </div>

      <Button variant="outline" size="sm" onClick={addLine} className="w-full">
        <Plus className="h-3 w-3 mr-1" /> Add Line
      </Button>

      <div>
        <Label>Stability</Label>
        <Select
          value={String(data.stability ?? 0.5)}
          onValueChange={(v) => onUpdate({ stability: parseFloat(v) })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Most Variable (0)</SelectItem>
            <SelectItem value="0.5">Balanced (0.5)</SelectItem>
            <SelectItem value="1">Most Stable (1.0)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>Language</Label>
        <Select
          value={data.languageCode || "auto"}
          onValueChange={(v) => onUpdate({ languageCode: v === "auto" ? "" : v })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto-detect</SelectItem>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="he">Hebrew</SelectItem>
            <SelectItem value="es">Spanish</SelectItem>
            <SelectItem value="fr">French</SelectItem>
            <SelectItem value="de">German</SelectItem>
            <SelectItem value="it">Italian</SelectItem>
            <SelectItem value="pt">Portuguese</SelectItem>
            <SelectItem value="ja">Japanese</SelectItem>
            <SelectItem value="zh">Chinese</SelectItem>
            <SelectItem value="ko">Korean</SelectItem>
            <SelectItem value="ar">Arabic</SelectItem>
            <SelectItem value="ru">Russian</SelectItem>
            <SelectItem value="hi">Hindi</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs text-muted-foreground">
        Multi-speaker dialogue using ElevenLabs voices. Each line is spoken by the selected voice. All lines are combined into a single audio output.
      </p>
    </div>
  )
}
