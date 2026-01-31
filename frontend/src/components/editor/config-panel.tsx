"use client"

import { X } from "lucide-react"
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
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type {
  TextPromptData,
  UploadImageData,
  UploadVideoData,
  RSSFeedData,
  ToneData,
  StyleGuideData,
  ProviderData,
  SceneCountData,
  DurationData,
  AspectRatioData,
  GenerateScriptData,
  GenerateImageData,
  ImageToVideoData,
  TextToSpeechData,
  QACheckData,
  CombineVideosData,
  AddAudioData,
  AddCaptionsData,
  ResizeVideoData,
  ExtractAudioData,
  MixAudioData,
  AdjustVolumeData,
  TrimVideoData,
  SaveToStorageData,
  WebhookOutputData,
} from "@/types/nodes"

interface ConfigProps<T> {
  readonly data: T
  readonly onUpdate: (d: Record<string, unknown>) => void
}

export function ConfigPanel() {
  const nodes = useWorkflowStore((s) => s.nodes)
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const deleteNode = useWorkflowStore((s) => s.deleteNode)

  const selectedNode = nodes.find((n) => n.id === selectedNodeId)

  if (!selectedNode) return null

  function update(data: Record<string, unknown>) {
    if (!selectedNodeId) return
    updateNodeData(selectedNodeId, data)
  }

  function handleDelete() {
    if (!selectedNodeId) return
    deleteNode(selectedNodeId)
  }

  return (
    <div className="absolute inset-0 z-10 bg-card shadow-lg flex flex-col sm:inset-auto sm:top-0 sm:right-0 sm:h-full sm:w-80 sm:border-l">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="text-sm font-semibold">Node Settings</h3>
        <Button variant="ghost" size="icon" onClick={() => selectNode(null)}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 px-4 py-3">
        <div className="flex flex-col gap-4">
          <div>
            <Label htmlFor="node-label">Label</Label>
            <Input
              id="node-label"
              value={(selectedNode.data as { label: string }).label}
              onChange={(e) => update({ label: e.target.value })}
            />
          </div>

          <Separator />

          {/* Input Nodes */}
          {selectedNode.type === "text-prompt" && (
            <TextPromptConfig data={selectedNode.data as TextPromptData} onUpdate={update} />
          )}
          {selectedNode.type === "upload-image" && (
            <UploadImageConfig data={selectedNode.data as UploadImageData} onUpdate={update} />
          )}
          {selectedNode.type === "upload-video" && (
            <UploadVideoConfig data={selectedNode.data as UploadVideoData} onUpdate={update} />
          )}
          {selectedNode.type === "rss-feed" && (
            <RSSFeedConfig data={selectedNode.data as RSSFeedData} onUpdate={update} />
          )}

          {/* Parameter Nodes */}
          {selectedNode.type === "tone" && (
            <ToneConfig data={selectedNode.data as ToneData} onUpdate={update} />
          )}
          {selectedNode.type === "style-guide" && (
            <StyleGuideConfig data={selectedNode.data as StyleGuideData} onUpdate={update} />
          )}
          {selectedNode.type === "provider" && (
            <ProviderConfig data={selectedNode.data as ProviderData} onUpdate={update} />
          )}
          {selectedNode.type === "scene-count" && (
            <SceneCountConfig data={selectedNode.data as SceneCountData} onUpdate={update} />
          )}
          {selectedNode.type === "duration" && (
            <DurationConfig data={selectedNode.data as DurationData} onUpdate={update} />
          )}
          {selectedNode.type === "aspect-ratio" && (
            <AspectRatioConfig data={selectedNode.data as AspectRatioData} onUpdate={update} />
          )}

          {/* AI Nodes */}
          {selectedNode.type === "generate-script" && (
            <GenerateScriptConfig data={selectedNode.data as GenerateScriptData} onUpdate={update} />
          )}
          {selectedNode.type === "generate-image" && (
            <GenerateImageConfig data={selectedNode.data as GenerateImageData} onUpdate={update} />
          )}
          {selectedNode.type === "image-to-video" && (
            <ImageToVideoConfig data={selectedNode.data as ImageToVideoData} onUpdate={update} />
          )}
          {selectedNode.type === "text-to-speech" && (
            <TextToSpeechConfig data={selectedNode.data as TextToSpeechData} onUpdate={update} />
          )}
          {selectedNode.type === "qa-check" && (
            <QACheckConfig data={selectedNode.data as QACheckData} onUpdate={update} />
          )}

          {/* Processing Nodes */}
          {selectedNode.type === "combine-videos" && (
            <CombineVideosConfig data={selectedNode.data as CombineVideosData} onUpdate={update} />
          )}
          {selectedNode.type === "add-audio" && (
            <AddAudioConfig data={selectedNode.data as AddAudioData} onUpdate={update} />
          )}
          {selectedNode.type === "add-captions" && (
            <AddCaptionsConfig data={selectedNode.data as AddCaptionsData} onUpdate={update} />
          )}
          {selectedNode.type === "resize-video" && (
            <ResizeVideoConfig data={selectedNode.data as ResizeVideoData} onUpdate={update} />
          )}
          {selectedNode.type === "extract-audio" && (
            <ExtractAudioConfig data={selectedNode.data as ExtractAudioData} onUpdate={update} />
          )}
          {selectedNode.type === "mix-audio" && (
            <MixAudioConfig data={selectedNode.data as MixAudioData} onUpdate={update} />
          )}
          {selectedNode.type === "adjust-volume" && (
            <AdjustVolumeConfig data={selectedNode.data as AdjustVolumeData} onUpdate={update} />
          )}
          {selectedNode.type === "trim-video" && (
            <TrimVideoConfig data={selectedNode.data as TrimVideoData} onUpdate={update} />
          )}

          {/* Output Nodes */}
          {selectedNode.type === "save-to-storage" && (
            <SaveToStorageConfig data={selectedNode.data as SaveToStorageData} onUpdate={update} />
          )}
          {selectedNode.type === "webhook-output" && (
            <WebhookOutputConfig data={selectedNode.data as WebhookOutputData} onUpdate={update} />
          )}

          <Separator />

          <Button variant="destructive" size="sm" onClick={handleDelete}>
            Delete Node
          </Button>
        </div>
      </ScrollArea>
    </div>
  )
}

/* ── Input Node Configs ── */

function TextPromptConfig({ data, onUpdate }: ConfigProps<TextPromptData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="prompt-text">Prompt Text</Label>
        <Textarea
          id="prompt-text"
          rows={5}
          value={data.text}
          onChange={(e) => onUpdate({ text: e.target.value })}
          placeholder="Enter your story prompt..."
        />
      </div>
    </div>
  )
}

function UploadImageConfig({ data, onUpdate }: ConfigProps<UploadImageData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="image-url">Image URL</Label>
        <Input
          id="image-url"
          value={data.url}
          onChange={(e) => onUpdate({ url: e.target.value })}
          placeholder="https://example.com/image.png"
        />
      </div>
    </div>
  )
}

function UploadVideoConfig({ data, onUpdate }: ConfigProps<UploadVideoData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="video-url">Video URL</Label>
        <Input
          id="video-url"
          value={data.url}
          onChange={(e) => onUpdate({ url: e.target.value })}
          placeholder="https://example.com/video.mp4"
        />
      </div>
    </div>
  )
}

function RSSFeedConfig({ data, onUpdate }: ConfigProps<RSSFeedData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="feed-url">Feed URL</Label>
        <Input
          id="feed-url"
          value={data.feedUrl}
          onChange={(e) => onUpdate({ feedUrl: e.target.value })}
          placeholder="https://example.com/feed.xml"
        />
      </div>
      <div>
        <Label htmlFor="item-index">Item Index</Label>
        <Input
          id="item-index"
          type="number"
          min={0}
          value={data.itemIndex}
          onChange={(e) => onUpdate({ itemIndex: parseInt(e.target.value, 10) || 0 })}
        />
      </div>
    </div>
  )
}

/* ── Parameter Node Configs ── */

function ToneConfig({ data, onUpdate }: ConfigProps<ToneData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="tone-value">Tone</Label>
        <Input
          id="tone-value"
          value={data.tone}
          onChange={(e) => onUpdate({ tone: e.target.value })}
          placeholder="e.g. dramatic, playful, dark"
        />
      </div>
    </div>
  )
}

function StyleGuideConfig({ data, onUpdate }: ConfigProps<StyleGuideData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="style-text">Style Description</Label>
        <Textarea
          id="style-text"
          rows={3}
          value={data.text}
          onChange={(e) => onUpdate({ text: e.target.value })}
          placeholder="e.g. Studio Ghibli watercolor..."
        />
      </div>
    </div>
  )
}

function ProviderConfig({ data, onUpdate }: ConfigProps<ProviderData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Category</Label>
        <Select
          value={data.category}
          onValueChange={(v) => onUpdate({ category: v as ProviderData["category"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="image">Image</SelectItem>
            <SelectItem value="video">Video</SelectItem>
            <SelectItem value="voice">Voice</SelectItem>
            <SelectItem value="script">Script</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="provider-name">Provider</Label>
        <Input
          id="provider-name"
          value={data.provider}
          onChange={(e) => onUpdate({ provider: e.target.value })}
          placeholder="e.g. nano-banana"
        />
      </div>
      <div>
        <Label htmlFor="model-name">Model</Label>
        <Input
          id="model-name"
          value={data.model}
          onChange={(e) => onUpdate({ model: e.target.value })}
          placeholder="e.g. gemini-2.5-flash-image"
        />
      </div>
    </div>
  )
}

function SceneCountConfig({ data, onUpdate }: ConfigProps<SceneCountData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="scene-count-val">Number of Scenes</Label>
        <Input
          id="scene-count-val"
          type="number"
          min={1}
          max={20}
          value={data.count}
          onChange={(e) => onUpdate({ count: parseInt(e.target.value, 10) || 5 })}
        />
      </div>
    </div>
  )
}

function DurationConfig({ data, onUpdate }: ConfigProps<DurationData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="duration-seconds">Duration (seconds)</Label>
        <Input
          id="duration-seconds"
          type="number"
          min={1}
          max={600}
          value={data.seconds}
          onChange={(e) => onUpdate({ seconds: parseInt(e.target.value, 10) || 60 })}
        />
      </div>
    </div>
  )
}

function AspectRatioConfig({ data, onUpdate }: ConfigProps<AspectRatioData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Aspect Ratio</Label>
        <Select
          value={data.ratio}
          onValueChange={(v) => onUpdate({ ratio: v as AspectRatioData["ratio"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1:1">1:1 (Square)</SelectItem>
            <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
            <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
            <SelectItem value="4:3">4:3</SelectItem>
            <SelectItem value="4:5">4:5</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

/* ── AI Node Configs ── */

function GenerateScriptConfig({ data, onUpdate }: ConfigProps<GenerateScriptData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Provider</Label>
        <Select
          value={data.provider}
          onValueChange={(v) => onUpdate({ provider: v as GenerateScriptData["provider"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="gemini">Gemini Flash</SelectItem>
            <SelectItem value="claude">Claude</SelectItem>
            <SelectItem value="gpt">GPT</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="scene-count">Number of Scenes</Label>
        <Input
          id="scene-count"
          type="number"
          min={1}
          max={20}
          value={data.sceneCount}
          onChange={(e) => onUpdate({ sceneCount: parseInt(e.target.value, 10) || 5 })}
        />
      </div>
      <div>
        <Label>Structure</Label>
        <Select
          value={data.structure}
          onValueChange={(v) => onUpdate({ structure: v as GenerateScriptData["structure"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="freeform">Freeform</SelectItem>
            <SelectItem value="8-step">8-Step Story</SelectItem>
            <SelectItem value="custom">Custom</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="style-guide">Style Guide</Label>
        <Textarea
          id="style-guide"
          rows={3}
          value={data.styleGuide}
          onChange={(e) => onUpdate({ styleGuide: e.target.value })}
          placeholder="e.g. children's book illustration, watercolor..."
        />
      </div>
      <div>
        <Label htmlFor="tone">Tone</Label>
        <Input
          id="tone"
          value={data.tone}
          onChange={(e) => onUpdate({ tone: e.target.value })}
          placeholder="e.g. whimsical, dramatic, educational"
        />
      </div>
      <div>
        <Label htmlFor="target-length">Target Length (seconds)</Label>
        <Input
          id="target-length"
          type="number"
          min={10}
          max={600}
          value={data.targetLength}
          onChange={(e) => onUpdate({ targetLength: parseInt(e.target.value, 10) || 60 })}
        />
      </div>
    </div>
  )
}

function GenerateImageConfig({ data, onUpdate }: ConfigProps<GenerateImageData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Provider</Label>
        <Select
          value={data.provider}
          onValueChange={(v) => onUpdate({ provider: v as GenerateImageData["provider"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="nano-banana">Nano Banana</SelectItem>
            <SelectItem value="flux">Flux</SelectItem>
            <SelectItem value="dalle">DALL-E</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Aspect Ratio</Label>
        <Select
          value={data.aspectRatio}
          onValueChange={(v) => onUpdate({ aspectRatio: v as GenerateImageData["aspectRatio"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1:1">1:1 (Square)</SelectItem>
            <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
            <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
            <SelectItem value="4:3">4:3</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="style">Style</Label>
        <Input
          id="style"
          value={data.style}
          onChange={(e) => onUpdate({ style: e.target.value })}
          placeholder="e.g. children-book, photorealistic"
        />
      </div>
      <div>
        <Label htmlFor="negative-prompt">Negative Prompt</Label>
        <Textarea
          id="negative-prompt"
          rows={2}
          value={data.negativePrompt}
          onChange={(e) => onUpdate({ negativePrompt: e.target.value })}
          placeholder="Things to avoid..."
        />
      </div>
    </div>
  )
}

function ImageToVideoConfig({ data, onUpdate }: ConfigProps<ImageToVideoData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Provider</Label>
        <Select
          value={data.provider}
          onValueChange={(v) => onUpdate({ provider: v as ImageToVideoData["provider"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="veo">VEO</SelectItem>
            <SelectItem value="kling">Kling</SelectItem>
            <SelectItem value="runway">Runway</SelectItem>
            <SelectItem value="pika">Pika</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="duration">Duration (seconds)</Label>
        <Input
          id="duration"
          type="number"
          min={1}
          max={30}
          value={data.duration}
          onChange={(e) => onUpdate({ duration: parseInt(e.target.value, 10) || 5 })}
        />
      </div>
      <div>
        <Label>Motion</Label>
        <Select
          value={data.motion}
          onValueChange={(v) => onUpdate({ motion: v as ImageToVideoData["motion"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="subtle">Subtle</SelectItem>
            <SelectItem value="moderate">Moderate</SelectItem>
            <SelectItem value="dynamic">Dynamic</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Camera Motion</Label>
        <Select
          value={data.cameraMotion}
          onValueChange={(v) => onUpdate({ cameraMotion: v as ImageToVideoData["cameraMotion"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="static">Static</SelectItem>
            <SelectItem value="pan-left">Pan Left</SelectItem>
            <SelectItem value="pan-right">Pan Right</SelectItem>
            <SelectItem value="zoom-in">Zoom In</SelectItem>
            <SelectItem value="zoom-out">Zoom Out</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

function TextToSpeechConfig({ data, onUpdate }: ConfigProps<TextToSpeechData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Provider</Label>
        <Select
          value={data.provider}
          onValueChange={(v) => onUpdate({ provider: v as TextToSpeechData["provider"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="elevenlabs">ElevenLabs</SelectItem>
            <SelectItem value="playht">PlayHT</SelectItem>
            <SelectItem value="azure">Azure TTS</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="voice-id">Voice ID</Label>
        <Input
          id="voice-id"
          value={data.voiceId}
          onChange={(e) => onUpdate({ voiceId: e.target.value })}
          placeholder="Voice identifier..."
        />
      </div>
      <div>
        <Label htmlFor="language">Language</Label>
        <Input
          id="language"
          value={data.language}
          onChange={(e) => onUpdate({ language: e.target.value })}
          placeholder="e.g. en, es, fr"
        />
      </div>
      <div>
        <Label htmlFor="speed">Speed</Label>
        <Input
          id="speed"
          type="number"
          min={0.5}
          max={2}
          step={0.1}
          value={data.speed}
          onChange={(e) => onUpdate({ speed: parseFloat(e.target.value) || 1 })}
        />
      </div>
      <div>
        <Label htmlFor="pitch">Pitch</Label>
        <Input
          id="pitch"
          type="number"
          min={0.5}
          max={2}
          step={0.1}
          value={data.pitch}
          onChange={(e) => onUpdate({ pitch: parseFloat(e.target.value) || 1 })}
        />
      </div>
    </div>
  )
}

function QACheckConfig({ data, onUpdate }: ConfigProps<QACheckData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Provider</Label>
        <Select
          value={data.provider}
          onValueChange={(v) => onUpdate({ provider: v as QACheckData["provider"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="claude">Claude</SelectItem>
            <SelectItem value="gpt">GPT</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Check Type</Label>
        <Select
          value={data.checkType}
          onValueChange={(v) => onUpdate({ checkType: v as QACheckData["checkType"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="content">Content</SelectItem>
            <SelectItem value="quality">Quality</SelectItem>
            <SelectItem value="consistency">Consistency</SelectItem>
            <SelectItem value="safety">Safety</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="threshold">Threshold</Label>
        <Input
          id="threshold"
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={data.threshold}
          onChange={(e) => onUpdate({ threshold: parseFloat(e.target.value) || 0.8 })}
        />
      </div>
    </div>
  )
}

/* ── Processing Node Configs ── */

function CombineVideosConfig({ data, onUpdate }: ConfigProps<CombineVideosData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Transition</Label>
        <Select
          value={data.transition}
          onValueChange={(v) => onUpdate({ transition: v as CombineVideosData["transition"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="cut">Cut</SelectItem>
            <SelectItem value="fade">Fade</SelectItem>
            <SelectItem value="dissolve">Dissolve</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="transition-duration">Transition Duration (s)</Label>
        <Input
          id="transition-duration"
          type="number"
          min={0}
          max={5}
          step={0.1}
          value={data.transitionDuration}
          onChange={(e) =>
            onUpdate({ transitionDuration: parseFloat(e.target.value) || 0.5 })
          }
        />
      </div>
    </div>
  )
}

function AddAudioConfig({ data, onUpdate }: ConfigProps<AddAudioData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Audio Type</Label>
        <Select
          value={data.audioType}
          onValueChange={(v) => onUpdate({ audioType: v as AddAudioData["audioType"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="voiceover">Voiceover</SelectItem>
            <SelectItem value="background">Background</SelectItem>
            <SelectItem value="both">Both</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="voiceover-vol">Voiceover Volume (%)</Label>
        <Input
          id="voiceover-vol"
          type="number"
          min={0}
          max={200}
          value={data.voiceoverVolume}
          onChange={(e) => onUpdate({ voiceoverVolume: parseInt(e.target.value, 10) || 100 })}
        />
      </div>
      <div>
        <Label htmlFor="bg-vol">Background Volume (%)</Label>
        <Input
          id="bg-vol"
          type="number"
          min={0}
          max={200}
          value={data.backgroundVolume}
          onChange={(e) => onUpdate({ backgroundVolume: parseInt(e.target.value, 10) || 30 })}
        />
      </div>
    </div>
  )
}

function AddCaptionsConfig({ data, onUpdate }: ConfigProps<AddCaptionsData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Style</Label>
        <Select
          value={data.style}
          onValueChange={(v) => onUpdate({ style: v as AddCaptionsData["style"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="subtitle">Subtitle</SelectItem>
            <SelectItem value="word-highlight">Word Highlight</SelectItem>
            <SelectItem value="karaoke">Karaoke</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Position</Label>
        <Select
          value={data.position}
          onValueChange={(v) => onUpdate({ position: v as AddCaptionsData["position"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="bottom">Bottom</SelectItem>
            <SelectItem value="top">Top</SelectItem>
            <SelectItem value="center">Center</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="font-size">Font Size</Label>
        <Input
          id="font-size"
          type="number"
          min={8}
          max={72}
          value={data.fontSize}
          onChange={(e) => onUpdate({ fontSize: parseInt(e.target.value, 10) || 24 })}
        />
      </div>
      <div>
        <Label htmlFor="caption-color">Color</Label>
        <Input
          id="caption-color"
          type="color"
          value={data.color}
          onChange={(e) => onUpdate({ color: e.target.value })}
        />
      </div>
    </div>
  )
}

function ResizeVideoConfig({ data, onUpdate }: ConfigProps<ResizeVideoData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Target Aspect Ratio</Label>
        <Select
          value={data.targetAspect}
          onValueChange={(v) => onUpdate({ targetAspect: v as ResizeVideoData["targetAspect"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1:1">1:1 (Square)</SelectItem>
            <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
            <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
            <SelectItem value="4:5">4:5</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Method</Label>
        <Select
          value={data.method}
          onValueChange={(v) => onUpdate({ method: v as ResizeVideoData["method"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="crop">Crop</SelectItem>
            <SelectItem value="pad">Pad</SelectItem>
            <SelectItem value="stretch">Stretch</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="pad-color">Pad Color</Label>
        <Input
          id="pad-color"
          type="color"
          value={data.padColor}
          onChange={(e) => onUpdate({ padColor: e.target.value })}
        />
      </div>
    </div>
  )
}

function ExtractAudioConfig({ data, onUpdate }: ConfigProps<ExtractAudioData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Audio Format</Label>
        <Select
          value={data.audioFormat}
          onValueChange={(v) => onUpdate({ audioFormat: v as ExtractAudioData["audioFormat"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="mp3">MP3</SelectItem>
            <SelectItem value="wav">WAV</SelectItem>
            <SelectItem value="aac">AAC</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="output-silent"
          checked={data.outputSilentVideo}
          onChange={(e) => onUpdate({ outputSilentVideo: e.target.checked })}
        />
        <Label htmlFor="output-silent">Output silent video</Label>
      </div>
    </div>
  )
}

function MixAudioConfig({ data, onUpdate }: ConfigProps<MixAudioData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="track-count">Track Count</Label>
        <Input
          id="track-count"
          type="number"
          min={2}
          max={8}
          value={data.trackCount}
          onChange={(e) => onUpdate({ trackCount: parseInt(e.target.value, 10) || 2 })}
        />
      </div>
    </div>
  )
}

function AdjustVolumeConfig({ data, onUpdate }: ConfigProps<AdjustVolumeData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="volume">Volume (%)</Label>
        <Input
          id="volume"
          type="number"
          min={0}
          max={200}
          value={data.volume}
          onChange={(e) => onUpdate({ volume: parseInt(e.target.value, 10) || 100 })}
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="normalize"
          checked={data.normalize}
          onChange={(e) => onUpdate({ normalize: e.target.checked })}
        />
        <Label htmlFor="normalize">Normalize</Label>
      </div>
      <div>
        <Label htmlFor="fade-in">Fade In (s)</Label>
        <Input
          id="fade-in"
          type="number"
          min={0}
          max={10}
          step={0.1}
          value={data.fadeIn}
          onChange={(e) => onUpdate({ fadeIn: parseFloat(e.target.value) || 0 })}
        />
      </div>
      <div>
        <Label htmlFor="fade-out">Fade Out (s)</Label>
        <Input
          id="fade-out"
          type="number"
          min={0}
          max={10}
          step={0.1}
          value={data.fadeOut}
          onChange={(e) => onUpdate({ fadeOut: parseFloat(e.target.value) || 0 })}
        />
      </div>
    </div>
  )
}

function TrimVideoConfig({ data, onUpdate }: ConfigProps<TrimVideoData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="start-time">Start Time (s)</Label>
        <Input
          id="start-time"
          type="number"
          min={0}
          step={0.1}
          value={data.startTime}
          onChange={(e) => onUpdate({ startTime: parseFloat(e.target.value) || 0 })}
        />
      </div>
      <div>
        <Label htmlFor="end-time">End Time (s)</Label>
        <Input
          id="end-time"
          type="number"
          min={0}
          step={0.1}
          value={data.endTime}
          onChange={(e) => onUpdate({ endTime: parseFloat(e.target.value) || 0 })}
        />
      </div>
    </div>
  )
}

/* ── Output Node Configs ── */

function SaveToStorageConfig({ data, onUpdate }: ConfigProps<SaveToStorageData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="filename">Filename</Label>
        <Input
          id="filename"
          value={data.filename}
          onChange={(e) => onUpdate({ filename: e.target.value })}
          placeholder="output_video"
        />
      </div>
      <div>
        <Label>Format</Label>
        <Select
          value={data.format}
          onValueChange={(v) => onUpdate({ format: v as SaveToStorageData["format"] })}
        >
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
        <Select
          value={data.quality}
          onValueChange={(v) => onUpdate({ quality: v as SaveToStorageData["quality"] })}
        >
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

function WebhookOutputConfig({ data, onUpdate }: ConfigProps<WebhookOutputData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="webhook-id">Webhook ID</Label>
        <Input
          id="webhook-id"
          value={data.webhookId}
          onChange={(e) => onUpdate({ webhookId: e.target.value })}
          placeholder="Select or enter webhook..."
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="include-asset"
          checked={data.includeAssetUrl}
          onChange={(e) => onUpdate({ includeAssetUrl: e.target.checked })}
        />
        <Label htmlFor="include-asset">Include asset URL</Label>
      </div>
    </div>
  )
}
