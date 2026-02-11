"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ReactFlowProvider } from "@xyflow/react"
import { Play, Loader2, Square, DollarSign, Layers, History } from "lucide-react"
import { WorkflowCanvas } from "./workflow-canvas"
import { NodeToolbar } from "./node-toolbar"
import { ConfigPanel } from "./config-panel"
import { EditorToolbar } from "./editor-toolbar"
import { UnsavedChangesDialog } from "./unsaved-changes-dialog"
import { ExecutionsTab } from "./executions-tab"
import { CostTab } from "./cost-tab"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { useWorkflowPersistence } from "@/hooks/use-workflow-persistence"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useProjectsStore } from "@/hooks/use-projects-store"
import { useAuth } from "@/hooks/use-auth"
import { createClient } from "@/lib/supabase"
import { generateImage, editImage, imageToImage, generateVideo, videoToVideo, textToVideo, textToSpeech, generateScriptApi, combineVideos, mergeVideoAudioApi, extractAudioApi, trimVideoApi, resizeVideoApi, adjustVolumeApi, addCaptionsApi, mixAudioApi, generateMusicApi, textToAudioApi, sunoGenerateApi, sunoCoverApi, sunoExtendApi, sunoLyricsApi, sunoSeparateApi, sunoMusicVideoApi, transcribeApi, downloadYouTubeAudio, lipSyncApi, motionTransferApi, videoUpscaleApi, generateCharacter, generateCharacterAsset, saveCharacter, generateFace, generateObject, generateObjectAsset, saveObject, generateLocation, generateLocationAsset, saveLocation, getJobStatus, getStats, getUserCredits } from "@/lib/api"
import { hasCredits } from "@/lib/edition"
import { getCachedCredits } from "@/hooks/use-model-credits"
import { InsufficientCreditsModal } from "@/components/credits/InsufficientCreditsModal"
import type { WorkflowNode, WorkflowEdge, TextPromptData, UploadImageData, UploadVideoData, GenerateImageData, EditImageData, ImageToImageData, GenerateScriptData, ImageToVideoData, VideoToVideoData, TextToVideoData, TextToSpeechData, GenerateMusicData, TextToAudioData, SunoGenerateData, SunoCoverData, SunoExtendData, SunoLyricsData, SunoSeparateData, SunoMusicVideoData, TranscribeData, LipSyncData, MotionTransferData, VideoUpscaleData, CombineVideosData, MergeVideoAudioData, ExtractAudioData, TrimVideoData, ResizeVideoData, AdjustVolumeData, AddCaptionsData, MixAudioData, CharacterNodeData, FaceNodeData, ObjectNodeData, LocationNodeData, GeneratedResult, GeneratedScript, GeneratedScriptResult, SceneImageVersion, SceneNodeDataType } from "@/types/nodes"
import { getSceneCharacterNames, mapScriptSceneToNodeData, NODE_DEFINITIONS } from "@/types/nodes"
import { buildScenePrompt } from "@/lib/prompt-builder"
import { resolveTemplate, applyTemplate } from "@/lib/prompt-templates"

/** Sentinel error thrown when a polling callback detects that the active
 *  workflow has changed. Callers should catch this silently (no error toast). */
class WorkflowStaleError extends Error {
  constructor() { super("Workflow changed during execution") }
}

const NODE_CREDIT_COSTS: Record<string, number> = {
  "generate-script": 2,
  "generate-image": 5,
  "edit-image": 3,
  "image-to-image": 5,
  "image-to-video": 20,
  "video-to-video": 25,
  "text-to-video": 25,
  "text-to-speech": 3,
  "generate-music": 5,
  "text-to-audio": 3,
  "suno-generate": 3,
  "suno-cover": 3,
  "suno-extend": 3,
  "suno-lyrics": 1,
  "suno-separate": 2,
  "suno-music-video": 1,
  "lip-sync": 40,
  "motion-transfer": 30,
  "video-upscale": 20,
  "transcribe": 2,
  "combine-videos": 2,
  "merge-video-audio": 1,
  "extract-audio": 1,
  "trim-video": 0,
  "resize-video": 1,
  "adjust-volume": 0,
  "add-captions": 2,
  "mix-audio": 1,
  "character": 5,
  "object": 5,
  "location": 5,
}

interface WorkflowEditorProps {
  readonly projectId?: string
  readonly workflowId?: string
}

export function WorkflowEditor({ projectId, workflowId }: WorkflowEditorProps) {
  const { user } = useAuth()
  const { save, load, saving, loading } = useWorkflowPersistence(projectId)
  const fetchProjects = useProjectsStore((s) => s.fetchProjects)
  const router = useRouter()
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [activeTab, setActiveTab] = useState<"editor" | "executions" | "cost">("editor")
  const [sidebarVisible, setSidebarVisible] = useState(false)
  const pendingNavRef = useRef<string | null>(null)
  const pollIntervalsRef = useRef<Set<ReturnType<typeof setInterval>>>(new Set())
  // Track the workflow ID this component instance owns. Polling callbacks
  // compare against this to avoid writing results into the wrong workflow.
  const ownerWorkflowIdRef = useRef<string | null>(workflowId ?? null)
  const [activeJobCount, setActiveJobCount] = useState(0)
  const [showInsufficientCredits, setShowInsufficientCredits] = useState(false)
  const [insufficientCreditsData, setInsufficientCreditsData] = useState<{
    required: number
    available: number
    tier: string
  } | null>(null)
  const [workflowCreditEstimate, setWorkflowCreditEstimate] = useState<number>(0)

  // Update credit estimate when nodes change
  const storeNodes = useWorkflowStore((s) => s.nodes)
  useEffect(() => {
    if (!hasCredits()) return
    const execTypes = new Set(["generate-script", "generate-image", "edit-image", "image-to-image", "image-to-video", "video-to-video", "text-to-video", "text-to-speech", "generate-music", "text-to-audio", "suno-generate", "suno-cover", "suno-extend", "suno-lyrics", "suno-separate", "suno-music-video", "transcribe", "lip-sync", "motion-transfer", "video-upscale", "combine-videos", "merge-video-audio", "extract-audio", "trim-video", "resize-video", "adjust-volume", "add-captions", "mix-audio", "scene", "character", "object", "location"])
    const executableNodes = storeNodes.filter((n) => execTypes.has(n.type ?? ""))
    const total = executableNodes.reduce((sum, node) => {
      const data = node.data as Record<string, unknown>
      const provider = data.provider as string | undefined
      if (provider) {
        const cached = getCachedCredits(provider)
        if (cached !== undefined) return sum + cached
      }
      return sum + (NODE_CREDIT_COSTS[node.type ?? ""] ?? 1)
    }, 0)
    setWorkflowCreditEstimate(total)
  }, [storeNodes])

  // Poll active job count for the Executions badge
  useEffect(() => {
    if (!user?.id) return

    let cancelled = false

    async function fetchActiveCount() {
      try {
        const result = await getStats("user", user!.id)
        if (!cancelled) {
          setActiveJobCount(result.data.pending + result.data.processing)
        }
      } catch {
        // Silently ignore - badge is non-critical
      }
    }

    fetchActiveCount()
    const interval = setInterval(fetchActiveCount, 10_000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [user?.id])

  useEffect(() => {
    if (workflowId) {
      // Stop any in-flight polls from a previously loaded workflow
      for (const interval of pollIntervalsRef.current) {
        clearInterval(interval)
      }
      pollIntervalsRef.current.clear()
      setIsRunning(false)

      ownerWorkflowIdRef.current = workflowId
      load(workflowId)
    }
  }, [workflowId, load])

  // Cleanup all polling intervals when the component unmounts so stale
  // callbacks cannot write results into a different workflow's nodes.
  useEffect(() => {
    return () => {
      ownerWorkflowIdRef.current = null
      for (const interval of pollIntervalsRef.current) {
        clearInterval(interval)
      }
      pollIntervalsRef.current.clear()
    }
  }, [])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  // Store projectId in workflow store for components that need it
  useEffect(() => {
    useWorkflowStore.getState().setProjectId(projectId ?? null)
  }, [projectId])

  const handleSave = useCallback(async () => {
    if (projectId) {
      await save(projectId)
    }
  }, [projectId, save])

  /**
   * Returns true when the store's active workflow no longer matches the
   * workflow that this component instance owns.  Polling callbacks should
   * call this before writing results to avoid cross-workflow contamination.
   */
  function isWorkflowStale(): boolean {
    const currentId = useWorkflowStore.getState().workflowId
    return currentId !== ownerWorkflowIdRef.current
  }

  function trackInterval(interval: ReturnType<typeof setInterval>) {
    pollIntervalsRef.current.add(interval)
    return interval
  }

  function untrackInterval(interval: ReturnType<typeof setInterval>) {
    clearInterval(interval)
    pollIntervalsRef.current.delete(interval)
    if (pollIntervalsRef.current.size === 0) {
      setIsRunning(false)
    }
  }

  function handleStop() {
    for (const interval of pollIntervalsRef.current) {
      clearInterval(interval)
    }
    pollIntervalsRef.current.clear()
    setIsRunning(false)

    const { nodes, updateNodeData } = useWorkflowStore.getState()
    for (const node of nodes) {
      if ((node.data as Record<string, unknown>).executionStatus === "running") {
        updateNodeData(node.id, { executionStatus: "idle" })
      }
    }
    toast.info("Execution stopped")
  }

  // --- Graph execution helpers ---

  const EXECUTABLE_TYPES = new Set(["generate-script", "generate-image", "edit-image", "image-to-image", "image-to-video", "video-to-video", "text-to-video", "text-to-speech", "generate-music", "text-to-audio", "suno-generate", "suno-cover", "suno-extend", "suno-lyrics", "suno-separate", "suno-music-video", "transcribe", "lip-sync", "motion-transfer", "video-upscale", "combine-videos", "merge-video-audio", "extract-audio", "trim-video", "resize-video", "adjust-volume", "add-captions", "mix-audio", "scene", "character", "face", "object", "location"])

  function isExecutableNode(node: WorkflowNode): boolean {
    return EXECUTABLE_TYPES.has(node.type ?? "")
  }

  function buildExecutionLevels(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode[][] {
    const inDegree = new Map<string, number>()
    const children = new Map<string, string[]>()
    const nodeMap = new Map<string, WorkflowNode>()

    for (const node of nodes) {
      nodeMap.set(node.id, node)
      inDegree.set(node.id, 0)
      children.set(node.id, [])
    }

    for (const edge of edges) {
      if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) continue
      inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)
      children.get(edge.source)?.push(edge.target)
    }

    const levels: WorkflowNode[][] = []
    let currentLevel = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0)

    while (currentLevel.length > 0) {
      levels.push(currentLevel)
      const nextLevel: WorkflowNode[] = []
      const seen = new Set<string>()

      for (const node of currentLevel) {
        for (const childId of children.get(node.id) ?? []) {
          const newDeg = (inDegree.get(childId) ?? 1) - 1
          inDegree.set(childId, newDeg)
          if (newDeg === 0 && !seen.has(childId)) {
            seen.add(childId)
            const childNode = nodeMap.get(childId)
            if (childNode) nextLevel.push(childNode)
          }
        }
      }

      currentLevel = nextLevel
    }

    return levels
  }

  function extractNodeOutput(node: WorkflowNode): string | undefined {
    const data = node.data as Record<string, unknown>
    const type = node.type

    if (type === "text-prompt") {
      return (data.text as string | undefined)?.trim()
    }
    if (type === "upload-image") {
      return (data.url as string | undefined)?.trim()
    }
    if (type === "upload-video") {
      return (data.url as string | undefined)?.trim()
    }
    if (type === "youtube-video") {
      // Prefer downloaded R2 URL for non-YouTube platforms; fall back to raw URL for YouTube
      return (data.downloadedVideoUrl as string | undefined)?.trim()
        || (data.youtubeUrl as string | undefined)?.trim()
    }
    if (type === "upload-audio") {
      return (data.r2Url as string | undefined)?.trim() || (data.url as string | undefined)?.trim()
    }
    if (type === "generate-image") {
      const results = (data.generatedResults as GeneratedResult[] | undefined) ?? []
      const activeIndex = (data.activeResultIndex as number | undefined) ?? 0
      // Check all possible URL fields to match thumbnail extraction logic
      return results[activeIndex]?.url ??
        (data.generatedImageUrl as string | undefined) ??
        (data.url as string | undefined)
    }
    if (type === "edit-image") {
      const results = (data.generatedResults as GeneratedResult[] | undefined) ?? []
      const activeIndex = (data.activeResultIndex as number | undefined) ?? 0
      return results[activeIndex]?.url ?? (data.generatedImageUrl as string | undefined)
    }
    if (type === "image-to-image") {
      const results = (data.generatedResults as GeneratedResult[] | undefined) ?? []
      const activeIndex = (data.activeResultIndex as number | undefined) ?? 0
      return results[activeIndex]?.url ?? (data.generatedImageUrl as string | undefined)
    }
    if (type === "combine-videos") {
      const results = (data.generatedResults as GeneratedResult[] | undefined) ?? []
      const activeIndex = (data.activeResultIndex as number | undefined) ?? 0
      return results[activeIndex]?.url ?? (data.generatedVideoUrl as string | undefined)
    }
    if (type === "image-to-video" || type === "video-to-video" || type === "text-to-video" || type === "lip-sync" || type === "motion-transfer" || type === "video-upscale" || type === "suno-music-video") {
      const results = (data.generatedResults as GeneratedResult[] | undefined) ?? []
      const activeIndex = (data.activeResultIndex as number | undefined) ?? 0
      return results[activeIndex]?.url ?? (data.generatedVideoUrl as string | undefined)
    }
    if (type === "text-to-speech" || type === "generate-music" || type === "text-to-audio" || type === "suno-generate" || type === "suno-cover" || type === "suno-extend" || type === "suno-separate") {
      const results = (data.generatedResults as GeneratedResult[] | undefined) ?? []
      const activeIndex = (data.activeResultIndex as number | undefined) ?? 0
      return results[activeIndex]?.url ?? (data.generatedAudioUrl as string | undefined)
    }
    if (type === "suno-lyrics") {
      return (data.generatedText as string | undefined)
    }
    if (type === "transcribe") {
      const tResults = (data.generatedResults as Array<{ text: string }> | undefined) ?? []
      const tActiveIndex = (data.activeResultIndex as number | undefined) ?? 0
      return tResults[tActiveIndex]?.text ?? (data.generatedText as string | undefined)
    }
    if (type === "generate-script") {
      const scriptResults = (data.generatedResults as GeneratedScriptResult[] | undefined) ?? []
      const activeIndex = (data.activeResultIndex as number | undefined) ?? 0
      const activeScript = scriptResults[activeIndex]?.script ?? (data.generatedScript as GeneratedScript | undefined)
      if (activeScript && activeScript.scenes.length > 0) {
        return activeScript.scenes[0].imagePrompt
      }
    }
    if (type === "merge-video-audio" || type === "add-captions" || type === "resize-video" || type === "trim-video") {
      const results = (data.generatedResults as GeneratedResult[] | undefined) ?? []
      const activeIndex = (data.activeResultIndex as number | undefined) ?? 0
      return results[activeIndex]?.url ?? (data.generatedVideoUrl as string | undefined)
    }
    if (type === "extract-audio" || type === "mix-audio") {
      const results = (data.generatedResults as GeneratedResult[] | undefined) ?? []
      const activeIndex = (data.activeResultIndex as number | undefined) ?? 0
      return results[activeIndex]?.url ?? (data.generatedAudioUrl as string | undefined)
    }
    if (type === "adjust-volume") {
      const results = (data.generatedResults as GeneratedResult[] | undefined) ?? []
      const activeIndex = (data.activeResultIndex as number | undefined) ?? 0
      const lastInputType = (data.lastInputType as string | undefined) ?? "audio"
      const fallbackUrl = lastInputType === "video"
        ? (data.generatedVideoUrl as string | undefined)
        : (data.generatedAudioUrl as string | undefined)
      return results[activeIndex]?.url ?? fallbackUrl
    }
    if (type === "reference-audio") {
      return (data.extractedAudioUrl as string | undefined)?.trim()
    }
    if (type === "character") {
      // Return the character's main portrait image for use as reference
      const results = (data.generatedResults as GeneratedResult[] | undefined) ?? []
      const activeIndex = (data.activeResultIndex as number | undefined) ?? 0
      return results[activeIndex]?.url ?? (data.sourceImageUrl as string | undefined)
    }
    if (type === "face") {
      // Return the face's portrait or reference image for facial identity
      const results = (data.generatedResults as GeneratedResult[] | undefined) ?? []
      const activeIndex = (data.activeResultIndex as number | undefined) ?? 0
      return results[activeIndex]?.url ?? (data.sourceImageUrl as string | undefined)
    }
    if (type === "object") {
      // Return the object's main image for use as reference
      const results = (data.generatedResults as GeneratedResult[] | undefined) ?? []
      const activeIndex = (data.activeResultIndex as number | undefined) ?? 0
      return results[activeIndex]?.url ?? (data.sourceImageUrl as string | undefined)
    }
    if (type === "location") {
      // Return the location's main image for use as reference
      const results = (data.generatedResults as GeneratedResult[] | undefined) ?? []
      const activeIndex = (data.activeResultIndex as number | undefined) ?? 0
      return results[activeIndex]?.url ?? (data.sourceImageUrl as string | undefined)
    }
    if (type === "scene") {
      // If scene has a generated image, return that; otherwise return built prompt
      const results = (data.generatedResults as GeneratedResult[] | undefined) ?? []
      const activeIndex = (data.activeResultIndex as number | undefined) ?? 0
      const imageUrl = results[activeIndex]?.url ?? (data.generatedImageUrl as string | undefined)
      if (imageUrl) return imageUrl
      const sceneData = data as unknown as SceneNodeDataType
      const { characterDefinitions } = useWorkflowStore.getState()
      return buildScenePrompt(sceneData, characterDefinitions)
    }
    return undefined
  }

  function resolveNodeInputs(node: WorkflowNode, nodes: WorkflowNode[], edges: WorkflowEdge[]) {
    const incomingEdges = edges.filter((e) => e.target === node.id)
    const sourceNodes = incomingEdges
      .map((e) => nodes.find((n) => n.id === e.source))
      .filter((n): n is WorkflowNode => n !== undefined)

    const inputs: { prompt?: string; imageUrl?: string; videoUrl?: string; videoUrls?: string[]; audioUrl?: string; audioUrls?: string[]; audioSources?: { url: string; sourceNodeId: string; sourceType?: "audio" | "video" }[]; referenceImageUrls?: string[]; sunoTrackId?: string; sunoTaskId?: string; uploadUrl?: string } = {}

    for (const src of sourceNodes) {
      const output = extractNodeOutput(src)
      if (!output) continue

      if (src.type === "text-prompt") {
        inputs.prompt = output
      } else if (src.type === "upload-image") {
        inputs.imageUrl = output
      } else if (src.type === "character") {
        // Character node provides its portrait as a reference image
        // Multiple Character nodes can be connected - all their portraits become references
        inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), output]
      } else if (src.type === "face") {
        // Face node provides its portrait as a reference image for facial identity
        inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), output]
      } else if (src.type === "object") {
        // Object node provides its main image as a reference image
        // Multiple Object nodes can be connected - all their images become references
        inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), output]
      } else if (src.type === "location") {
        // Location node provides its main image as a reference image
        // Multiple Location nodes can be connected - all their images become references
        inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), output]
      } else if (src.type === "upload-video" || src.type === "youtube-video") {
        if (node.type === "suno-cover" && src.type === "youtube-video") {
          // For suno-cover, prefer downloaded audio URL over raw YouTube URL
          const srcData = src.data as Record<string, unknown>
          const audioUrl = (srcData.downloadedAudioUrl as string | undefined)?.trim()
          inputs.uploadUrl = audioUrl || output
        } else if (node.type === "combine-videos") {
          inputs.videoUrls = [...(inputs.videoUrls ?? []), output]
        } else if (node.type === "merge-video-audio") {
          // First video → main video; additional videos → audio extraction sources
          if (!inputs.videoUrl) {
            inputs.videoUrl = output
          } else {
            inputs.audioSources = [...(inputs.audioSources ?? []), { url: output, sourceNodeId: src.id, sourceType: "video" as const }]
          }
        } else {
          inputs.videoUrl = output
        }
      } else if (src.type === "generate-image") {
        if (node.type === "generate-image") {
          inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), output]
        } else if (node.type === "text-to-audio") {
          inputs.prompt = (src.data as GenerateImageData).prompt ?? ""
        } else {
          inputs.imageUrl = output
        }
      } else if (src.type === "edit-image") {
        // Edit image outputs an image - can be used as input to other nodes
        if (node.type === "generate-image" || node.type === "edit-image" || node.type === "image-to-image") {
          inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), output]
        } else {
          inputs.imageUrl = output
        }
      } else if (src.type === "image-to-image") {
        // Image-to-image outputs an image - can be used as input to other nodes
        if (node.type === "generate-image" || node.type === "edit-image" || node.type === "image-to-image") {
          inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), output]
        } else {
          inputs.imageUrl = output
        }
      } else if (src.type === "image-to-video" || src.type === "video-to-video" || src.type === "text-to-video" || src.type === "lip-sync" || src.type === "motion-transfer" || src.type === "video-upscale" || src.type === "suno-music-video" || src.type === "combine-videos" || src.type === "merge-video-audio" || src.type === "add-captions" || src.type === "resize-video" || src.type === "trim-video") {
        if (node.type === "combine-videos") {
          inputs.videoUrls = [...(inputs.videoUrls ?? []), output]
        } else if (node.type === "merge-video-audio") {
          // First video → main video; additional videos → audio extraction sources
          if (!inputs.videoUrl) {
            inputs.videoUrl = output
          } else {
            inputs.audioSources = [...(inputs.audioSources ?? []), { url: output, sourceNodeId: src.id, sourceType: "video" as const }]
          }
        } else {
          inputs.videoUrl = output
        }
      } else if (src.type === "reference-audio") {
        if (node.type === "generate-music") {
          inputs.audioUrl = output
        } else if (node.type === "mix-audio") {
          inputs.audioUrls = [...(inputs.audioUrls ?? []), output]
        } else {
          inputs.audioUrl = output
        }
      } else if (src.type === "scene") {
        // Scene node provides prompt text + reference images from attached assets
        const sceneData = src.data as unknown as SceneNodeDataType
        const { characterDefinitions } = useWorkflowStore.getState()
        inputs.prompt = buildScenePrompt(sceneData, characterDefinitions)
        // If scene has a generated image, provide it as imageUrl
        const sceneResults = (sceneData.generatedResults as GeneratedResult[] | undefined) ?? []
        const sceneActiveIdx = (sceneData.activeResultIndex as number | undefined) ?? 0
        const sceneImageUrl = sceneResults[sceneActiveIdx]?.url ?? sceneData.generatedImageUrl
        if (sceneImageUrl) {
          if (node.type === "generate-image") {
            inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), sceneImageUrl]
          } else {
            inputs.imageUrl = sceneImageUrl
          }
        }
        // Collect reference images from all attached assets (characters, location, objects)
        const allAssetIds = [
          ...sceneData.characters.map((c) => c.assetId),
          ...(sceneData.locations ?? []).map((l) => l.assetId),
          ...sceneData.objects.map((o) => o.assetId),
        ]
        for (const assetId of allAssetIds) {
          const asset = characterDefinitions.find((a) => a.id === assetId)
          if (asset?.referenceImageUrl) {
            inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), asset.referenceImageUrl]
          }
        }
      } else if (src.type === "upload-audio") {
        if (node.type === "mix-audio") {
          inputs.audioUrls = [...(inputs.audioUrls ?? []), output]
        } else if (node.type === "merge-video-audio") {
          inputs.audioSources = [...(inputs.audioSources ?? []), { url: output, sourceNodeId: src.id }]
        } else {
          inputs.audioUrl = output
        }
      } else if (src.type === "adjust-volume") {
        const adjustData = src.data as AdjustVolumeData
        const lastInputType = adjustData.lastInputType ?? "audio"
        if (lastInputType === "video") {
          inputs.videoUrl = output
        } else if (node.type === "mix-audio") {
          inputs.audioUrls = [...(inputs.audioUrls ?? []), output]
        } else if (node.type === "merge-video-audio") {
          inputs.audioSources = [...(inputs.audioSources ?? []), { url: output, sourceNodeId: src.id }]
        } else {
          inputs.audioUrl = output
        }
      } else if (src.type === "text-to-speech" || src.type === "generate-music" || src.type === "text-to-audio" || src.type === "suno-generate" || src.type === "suno-cover" || src.type === "suno-extend" || src.type === "suno-separate" || src.type === "extract-audio" || src.type === "mix-audio") {
        if (node.type === "mix-audio") {
          inputs.audioUrls = [...(inputs.audioUrls ?? []), output]
        } else if (node.type === "merge-video-audio") {
          inputs.audioSources = [...(inputs.audioSources ?? []), { url: output, sourceNodeId: src.id }]
        } else {
          inputs.audioUrl = output
        }
        // Pass sunoTrackId + sunoTaskId from suno nodes to downstream suno-extend/separate
        if (src.type === "suno-generate" || src.type === "suno-cover" || src.type === "suno-extend") {
          const srcData = src.data as Record<string, unknown>
          if (srcData.sunoTrackId) {
            inputs.sunoTrackId = srcData.sunoTrackId as string
          }
          if (srcData.sunoTaskId) {
            inputs.sunoTaskId = srcData.sunoTaskId as string
          }
        }
      } else if (src.type === "transcribe" || src.type === "suno-lyrics") {
        // Transcribe / lyrics output text - can feed into add-captions, text-prompt downstream, etc.
        inputs.prompt = output
      }
    }

    return inputs
  }

  // --- Promise-based node execution ---

  function runImageGeneration(nodeId: string, prompt: string, referenceImageUrls?: string[], provider?: string, aspectRatio?: string): Promise<void> {
    const { updateNodeData } = useWorkflowStore.getState()
    updateNodeData(nodeId, { executionStatus: "running", generatedImageUrl: undefined })

    return new Promise((resolve, reject) => {
      generateImage(prompt, referenceImageUrls, provider, undefined, aspectRatio, user?.id).then(({ jobId }) => {
        toast.info("Image generation started", { description: `Job ID: ${jobId}` })

        const poll = trackInterval(setInterval(async () => {
          if (isWorkflowStale()) { untrackInterval(poll); reject(new WorkflowStaleError()); return }
          try {
            const job = await getJobStatus(jobId)
            if (job.status === "completed") {
              untrackInterval(poll)
              const imageUrl = job.output_data?.imageUrl
              const existingResults = ((useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)?.data) as GenerateImageData | undefined)?.generatedResults ?? []
              const newResult: GeneratedResult = { url: imageUrl ?? "", timestamp: new Date().toISOString(), jobId }
              updateNodeData(nodeId, {
                executionStatus: "completed",
                generatedImageUrl: imageUrl,
                generatedResults: [newResult, ...existingResults],
                activeResultIndex: 0,
              })
              toast.success("Image generated")
              resolve()
            } else if (job.status === "failed") {
              untrackInterval(poll)
              const errMsg = job.error_message ?? "Unknown error"
              updateNodeData(nodeId, { executionStatus: "failed", errorMessage: errMsg })
              toast.error("Image generation failed", { description: errMsg })
              reject(new Error(errMsg))
            }
          } catch (err) {
            untrackInterval(poll)
            const errMsg = err instanceof Error ? err.message : "Failed to check job status"
            updateNodeData(nodeId, { executionStatus: "failed", errorMessage: errMsg })
            toast.error("Failed to check job status")
            reject(err)
          }
        }, 2000))
      }).catch((err) => {
        const errMsg = err instanceof Error ? err.message : "Unknown error"
        updateNodeData(nodeId, { executionStatus: "failed", errorMessage: errMsg })
        toast.error("Failed to start image generation", { description: errMsg })
        reject(err)
      })
    })
  }

  function runEditImage(nodeId: string, imageUrl: string, prompt?: string, provider?: "recraft-upscale" | "recraft-remove-bg" | "nano-banana-edit"): Promise<void> {
    const { updateNodeData } = useWorkflowStore.getState()
    updateNodeData(nodeId, { executionStatus: "running", generatedImageUrl: undefined })

    return new Promise((resolve, reject) => {
      editImage(imageUrl, prompt, provider, user?.id).then(({ jobId }) => {
        toast.info("Image editing started", { description: `Job ID: ${jobId}` })

        const poll = trackInterval(setInterval(async () => {
          if (isWorkflowStale()) { untrackInterval(poll); reject(new WorkflowStaleError()); return }
          try {
            const job = await getJobStatus(jobId)
            if (job.status === "completed") {
              untrackInterval(poll)
              const outputUrl = job.output_data?.imageUrl
              const existingResults = ((useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)?.data) as EditImageData | undefined)?.generatedResults ?? []
              const newResult: GeneratedResult = { url: outputUrl ?? "", timestamp: new Date().toISOString(), jobId }
              updateNodeData(nodeId, {
                executionStatus: "completed",
                generatedImageUrl: outputUrl,
                generatedResults: [newResult, ...existingResults],
                activeResultIndex: 0,
              })
              toast.success("Image edited")
              resolve()
            } else if (job.status === "failed") {
              untrackInterval(poll)
              const errMsg = job.error_message ?? "Unknown error"
              updateNodeData(nodeId, { executionStatus: "failed", errorMessage: errMsg })
              toast.error("Image editing failed", { description: errMsg })
              reject(new Error(errMsg))
            }
          } catch (err) {
            untrackInterval(poll)
            const errMsg = err instanceof Error ? err.message : "Failed to check job status"
            updateNodeData(nodeId, { executionStatus: "failed", errorMessage: errMsg })
            toast.error("Failed to check job status")
            reject(err)
          }
        }, 2000))
      }).catch((err) => {
        const errMsg = err instanceof Error ? err.message : "Unknown error"
        updateNodeData(nodeId, { executionStatus: "failed", errorMessage: errMsg })
        toast.error("Failed to start image editing", { description: errMsg })
        reject(err)
      })
    })
  }

  function runImageToImage(nodeId: string, imageUrl: string, prompt: string, provider?: ImageToImageData["provider"], referenceImageUrls?: string[]): Promise<void> {
    const { updateNodeData } = useWorkflowStore.getState()
    updateNodeData(nodeId, { executionStatus: "running", generatedImageUrl: undefined })

    return new Promise((resolve, reject) => {
      imageToImage(imageUrl, prompt, provider, user?.id, referenceImageUrls).then(({ jobId }) => {
        toast.info("Image transformation started", { description: `Job ID: ${jobId}` })

        const poll = trackInterval(setInterval(async () => {
          if (isWorkflowStale()) { untrackInterval(poll); reject(new WorkflowStaleError()); return }
          try {
            const job = await getJobStatus(jobId)
            if (job.status === "completed") {
              untrackInterval(poll)
              const outputUrl = job.output_data?.imageUrl
              const existingResults = ((useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)?.data) as ImageToImageData | undefined)?.generatedResults ?? []
              const newResult: GeneratedResult = { url: outputUrl ?? "", timestamp: new Date().toISOString(), jobId }
              updateNodeData(nodeId, {
                executionStatus: "completed",
                generatedImageUrl: outputUrl,
                generatedResults: [newResult, ...existingResults],
                activeResultIndex: 0,
              })
              toast.success("Image transformed")
              resolve()
            } else if (job.status === "failed") {
              untrackInterval(poll)
              const errMsg = job.error_message ?? "Unknown error"
              updateNodeData(nodeId, { executionStatus: "failed", errorMessage: errMsg })
              toast.error("Image transformation failed", { description: errMsg })
              reject(new Error(errMsg))
            }
          } catch (err) {
            untrackInterval(poll)
            const errMsg = err instanceof Error ? err.message : "Failed to check job status"
            updateNodeData(nodeId, { executionStatus: "failed", errorMessage: errMsg })
            toast.error("Failed to check job status")
            reject(err)
          }
        }, 2000))
      }).catch((err) => {
        const errMsg = err instanceof Error ? err.message : "Unknown error"
        updateNodeData(nodeId, { executionStatus: "failed", errorMessage: errMsg })
        toast.error("Failed to start image transformation", { description: errMsg })
        reject(err)
      })
    })
  }

  function runCharacterGeneration(nodeId: string, data: CharacterNodeData): Promise<void> {
    const { updateNodeData } = useWorkflowStore.getState()
    updateNodeData(nodeId, { executionStatus: "running" })

    return new Promise((resolve, reject) => {
      generateCharacter({
        name: data.characterName,
        description: data.description || undefined,
        gender: data.gender || undefined,
        style: data.style || undefined,
        baseOutfit: data.baseOutfit || undefined,
        sourceImageUrl: data.sourceImageUrl || undefined,
        userId: user?.id,
      }).then(({ jobId }) => {
        toast.info("Character generation started", { description: `Job ID: ${jobId}` })

        const poll = trackInterval(setInterval(async () => {
          if (isWorkflowStale()) { untrackInterval(poll); reject(new WorkflowStaleError()); return }
          try {
            const job = await getJobStatus(jobId)
            if (job.status === "completed") {
              untrackInterval(poll)
              const imageUrl = job.output_data?.imageUrl
              const currentNode = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)
              const currentData = currentNode?.data as CharacterNodeData | undefined
              const existingResults = currentData?.generatedResults ?? []
              const newResult: GeneratedResult = { url: imageUrl ?? "", timestamp: new Date().toISOString(), jobId }
              updateNodeData(nodeId, {
                executionStatus: "completed",
                sourceImageUrl: imageUrl,
                generatedResults: [newResult, ...existingResults],
                activeResultIndex: 0,
              })
              toast.success("Character portrait generated")

              // Save/update character in database
              console.log("🟢🟢🟢 ATTEMPTING TO SAVE CHARACTER TO DB 🟢🟢🟢", { characterDbId: currentData?.characterDbId, nodeId, projectId, name: data.characterName })
              const supabase = createClient()
              const { data: { user } } = await supabase.auth.getUser()
              saveCharacter({
                id: currentData?.characterDbId || undefined,
                userId: user?.id,
                nodeId,
                projectId: projectId || undefined,
                name: data.characterName,
                description: data.description || undefined,
                gender: data.gender || undefined,
                style: data.style || undefined,
                baseOutfit: data.baseOutfit || undefined,
                sourceImageUrl: imageUrl || undefined,
                expressions: currentData?.expressions ?? [],
                poses: currentData?.poses ?? [],
                lightingVariations: currentData?.lightingVariations ?? [],
              }).then(({ id: dbId }) => {
                console.log("🟢🟢🟢 CHARACTER SAVED SUCCESSFULLY, dbId:", dbId, "🟢🟢🟢")
                if (!currentData?.characterDbId) {
                  updateNodeData(nodeId, { characterDbId: dbId })
                }
              }).catch((err) => {
                console.log("🔴🔴🔴 SAVE CHARACTER FAILED:", err, "🔴🔴🔴")
              })

              resolve()
            } else if (job.status === "failed") {
              untrackInterval(poll)
              const errMsg = job.error_message ?? "Unknown error"
              updateNodeData(nodeId, { executionStatus: "failed", errorMessage: errMsg })
              toast.error("Character generation failed", { description: errMsg })
              reject(new Error(errMsg))
            }
          } catch (err) {
            untrackInterval(poll)
            const errMsg = err instanceof Error ? err.message : "Failed to check job status"
            updateNodeData(nodeId, { executionStatus: "failed", errorMessage: errMsg })
            toast.error("Failed to check job status")
            reject(err)
          }
        }, 2000))
      }).catch((err) => {
        const errMsg = err instanceof Error ? err.message : "Unknown error"
        updateNodeData(nodeId, { executionStatus: "failed", errorMessage: errMsg })
        toast.error("Failed to start character generation", { description: errMsg })
        reject(err)
      })
    })
  }

  function runFaceGeneration(nodeId: string, data: FaceNodeData): Promise<void> {
    const { updateNodeData } = useWorkflowStore.getState()
    updateNodeData(nodeId, { executionStatus: "running" })

    return new Promise((resolve, reject) => {
      generateFace({
        name: data.faceName,
        description: data.description || undefined,
        style: data.style || undefined,
        sourceImageUrl: data.sourceImageUrl || undefined,
        userId: user?.id,
      }).then(({ jobId }) => {
        toast.info("Face headshot generation started", { description: `Job ID: ${jobId}` })

        const poll = trackInterval(setInterval(async () => {
          if (isWorkflowStale()) { untrackInterval(poll); reject(new WorkflowStaleError()); return }
          try {
            const job = await getJobStatus(jobId)
            if (job.status === "completed") {
              untrackInterval(poll)
              const imageUrl = job.output_data?.imageUrl
              const currentNode = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)
              const currentData = currentNode?.data as FaceNodeData | undefined
              const existingResults = currentData?.generatedResults ?? []
              const newResult: GeneratedResult = { url: imageUrl ?? "", timestamp: new Date().toISOString(), jobId }
              updateNodeData(nodeId, {
                executionStatus: "completed",
                sourceImageUrl: data.sourceImageUrl || imageUrl,
                generatedResults: [newResult, ...existingResults],
                activeResultIndex: 0,
              })
              toast.success("Face headshot generated")
              resolve()
            } else if (job.status === "failed") {
              untrackInterval(poll)
              const errMsg = job.error_message ?? "Unknown error"
              updateNodeData(nodeId, { executionStatus: "failed", errorMessage: errMsg })
              toast.error("Face headshot generation failed", { description: errMsg })
              reject(new Error(errMsg))
            }
          } catch (err) {
            untrackInterval(poll)
            const errMsg = err instanceof Error ? err.message : "Failed to check job status"
            updateNodeData(nodeId, { executionStatus: "failed", errorMessage: errMsg })
            toast.error("Failed to check job status")
            reject(err)
          }
        }, 2000))
      }).catch((err) => {
        const errMsg = err instanceof Error ? err.message : "Unknown error"
        updateNodeData(nodeId, { executionStatus: "failed", errorMessage: errMsg })
        toast.error("Failed to start face headshot generation", { description: errMsg })
        reject(err)
      })
    })
  }

  function runObjectGeneration(nodeId: string, data: ObjectNodeData): Promise<void> {
    const { updateNodeData } = useWorkflowStore.getState()
    updateNodeData(nodeId, { executionStatus: "running" })

    return new Promise((resolve, reject) => {
      generateObject({
        name: data.objectName,
        description: data.description || undefined,
        category: data.category || undefined,
        style: data.style || undefined,
        sourceImageUrl: data.sourceImageUrl || undefined,
        userId: user?.id,
      }).then(({ jobId }) => {
        toast.info("Object generation started", { description: `Job ID: ${jobId}` })

        const poll = trackInterval(setInterval(async () => {
          if (isWorkflowStale()) { untrackInterval(poll); reject(new WorkflowStaleError()); return }
          try {
            const job = await getJobStatus(jobId)
            if (job.status === "completed") {
              untrackInterval(poll)
              const imageUrl = job.output_data?.imageUrl
              const currentNode = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)
              const currentData = currentNode?.data as ObjectNodeData | undefined
              const existingResults = currentData?.generatedResults ?? []
              const newResult: GeneratedResult = { url: imageUrl ?? "", timestamp: new Date().toISOString(), jobId }
              updateNodeData(nodeId, {
                executionStatus: "completed",
                sourceImageUrl: imageUrl,
                generatedResults: [newResult, ...existingResults],
                activeResultIndex: 0,
              })
              toast.success("Object image generated")

              // Save/update object in database
              const supabaseObj = createClient()
              const { data: { user: objUser } } = await supabaseObj.auth.getUser()
              saveObject({
                id: currentData?.objectDbId || undefined,
                userId: objUser?.id,
                nodeId,
                projectId: projectId || undefined,
                name: data.objectName,
                description: data.description || undefined,
                category: data.category || undefined,
                style: data.style || undefined,
                sourceImageUrl: imageUrl || undefined,
                angles: currentData?.angles ?? [],
                materials: currentData?.materials ?? [],
                variations: currentData?.variations ?? [],
              }).then(({ id: dbId }) => {
                if (!currentData?.objectDbId) {
                  updateNodeData(nodeId, { objectDbId: dbId })
                }
              }).catch(() => { /* best-effort */ })

              resolve()
            } else if (job.status === "failed") {
              untrackInterval(poll)
              const errMsg = job.error_message ?? "Unknown error"
              updateNodeData(nodeId, { executionStatus: "failed", errorMessage: errMsg })
              toast.error("Object generation failed", { description: errMsg })
              reject(new Error(errMsg))
            }
          } catch (err) {
            untrackInterval(poll)
            const errMsg = err instanceof Error ? err.message : "Failed to check job status"
            updateNodeData(nodeId, { executionStatus: "failed", errorMessage: errMsg })
            toast.error("Failed to check job status")
            reject(err)
          }
        }, 2000))
      }).catch((err) => {
        const errMsg = err instanceof Error ? err.message : "Unknown error"
        updateNodeData(nodeId, { executionStatus: "failed", errorMessage: errMsg })
        toast.error("Failed to start object generation", { description: errMsg })
        reject(err)
      })
    })
  }

  function runLocationGeneration(nodeId: string, data: LocationNodeData): Promise<void> {
    const { updateNodeData } = useWorkflowStore.getState()
    updateNodeData(nodeId, { executionStatus: "running" })

    return new Promise((resolve, reject) => {
      generateLocation({
        name: data.locationName,
        description: data.description || undefined,
        category: data.category || undefined,
        style: data.style || undefined,
        sourceImageUrl: data.sourceImageUrl || undefined,
        userId: user?.id,
      }).then(({ jobId }) => {
        toast.info("Location generation started", { description: `Job ID: ${jobId}` })

        const poll = trackInterval(setInterval(async () => {
          if (isWorkflowStale()) { untrackInterval(poll); reject(new WorkflowStaleError()); return }
          try {
            const job = await getJobStatus(jobId)
            if (job.status === "completed") {
              untrackInterval(poll)
              const imageUrl = job.output_data?.imageUrl
              const currentNode = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)
              const currentData = currentNode?.data as LocationNodeData | undefined
              const existingResults = currentData?.generatedResults ?? []
              const newResult: GeneratedResult = { url: imageUrl ?? "", timestamp: new Date().toISOString(), jobId }
              updateNodeData(nodeId, {
                executionStatus: "completed",
                sourceImageUrl: imageUrl,
                generatedResults: [newResult, ...existingResults],
                activeResultIndex: 0,
              })
              toast.success("Location image generated")

              // Save/update location in database
              const supabaseLoc = createClient()
              const { data: { user: locUser } } = await supabaseLoc.auth.getUser()
              saveLocation({
                id: currentData?.locationDbId || undefined,
                userId: locUser?.id,
                nodeId,
                projectId: projectId || undefined,
                name: data.locationName,
                description: data.description || undefined,
                category: data.category || undefined,
                style: data.style || undefined,
                sourceImageUrl: imageUrl || undefined,
                timeOfDay: currentData?.timeOfDay ?? [],
                weather: currentData?.weather ?? [],
                angles: currentData?.angles ?? [],
              }).then(({ id: dbId }) => {
                if (!currentData?.locationDbId) {
                  updateNodeData(nodeId, { locationDbId: dbId })
                }
              }).catch(() => { /* best-effort */ })

              resolve()
            } else if (job.status === "failed") {
              untrackInterval(poll)
              const errMsg = job.error_message ?? "Unknown error"
              updateNodeData(nodeId, { executionStatus: "failed", errorMessage: errMsg })
              toast.error("Location generation failed", { description: errMsg })
              reject(new Error(errMsg))
            }
          } catch (err) {
            untrackInterval(poll)
            updateNodeData(nodeId, { executionStatus: "failed" })
            toast.error("Failed to check job status")
            reject(err)
          }
        }, 2000))
      }).catch((err) => {
        updateNodeData(nodeId, { executionStatus: "failed" })
        toast.error("Failed to start location generation", {
          description: err instanceof Error ? err.message : "Unknown error",
        })
        reject(err)
      })
    })
  }

  const ASSET_VARIANTS: Record<string, { variants: string[]; names: string[] }> = {
    expressions: { variants: ["neutral", "smile", "angry", "surprised", "sad", "talking"], names: ["Neutral", "Smile", "Angry", "Surprised", "Sad", "Talking"] },
    poses: { variants: ["standing", "walking", "sitting", "running"], names: ["Standing", "Walking", "Sitting", "Running"] },
    lighting: { variants: ["daylight", "night", "dramatic"], names: ["Daylight", "Night", "Dramatic"] },
    angles: { variants: ["front", "side", "back"], names: ["Front View", "Side View", "Back View"] },
  }

  const OBJECT_ASSET_VARIANTS: Record<string, { variants: string[]; names: string[] }> = {
    angles: { variants: ["front", "side", "top", "back", "three-quarter"], names: ["Front", "Side", "Top", "Back", "Three-Quarter"] },
    materials: { variants: ["wood", "metal", "glass", "plastic", "fabric", "stone"], names: ["Wood", "Metal", "Glass", "Plastic", "Fabric", "Stone"] },
    variations: { variants: ["clean", "weathered", "damaged", "ornate", "minimal"], names: ["Clean", "Weathered", "Damaged", "Ornate", "Minimal"] },
  }

  const LOCATION_ASSET_VARIANTS: Record<string, { variants: string[]; names: string[] }> = {
    timeOfDay: { variants: ["dawn", "morning", "noon", "afternoon", "dusk", "night"], names: ["Dawn", "Morning", "Noon", "Afternoon", "Dusk", "Night"] },
    weather: { variants: ["clear", "cloudy", "rain", "storm", "snow", "fog"], names: ["Clear", "Cloudy", "Rain", "Storm", "Snow", "Fog"] },
    angles: { variants: ["wide", "medium", "closeup", "aerial", "low-angle"], names: ["Wide", "Medium", "Close-up", "Aerial", "Low Angle"] },
  }

  function pollJobToCompletion(jobId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const poll = trackInterval(setInterval(async () => {
        if (isWorkflowStale()) { untrackInterval(poll); reject(new WorkflowStaleError()); return }
        try {
          const job = await getJobStatus(jobId)
          if (job.status === "completed") {
            untrackInterval(poll)
            resolve(job.output_data?.imageUrl ?? "")
          } else if (job.status === "failed") {
            untrackInterval(poll)
            reject(new Error(job.error_message ?? "Failed"))
          }
        } catch (err) {
          untrackInterval(poll)
          reject(err)
        }
      }, 2000))
    })
  }

  async function handleGenerateCharacterAsset(nodeId: string, assetType: "expressions" | "poses" | "lighting" | "angles"): Promise<void> {
    const { updateNodeData } = useWorkflowStore.getState()
    const node = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)
    if (!node) return
    const data = node.data as CharacterNodeData
    if (!data.characterName) {
      toast.error("Set a character name first")
      return
    }
    const activeResult = (data.generatedResults ?? [])[data.activeResultIndex ?? 0]
    const portraitUrl = activeResult?.url ?? data.sourceImageUrl
    if (!portraitUrl) {
      toast.error("Generate or upload a main portrait first")
      return
    }

    const statusKeyMap: Record<string, string> = { expressions: "expressionStatus", poses: "poseStatus", lighting: "lightingStatus", angles: "anglesStatus" }
    const itemsKeyMap: Record<string, string> = { expressions: "expressions", poses: "poses", lighting: "lightingVariations", angles: "angles" }
    const statusKey = statusKeyMap[assetType]
    const itemsKey = itemsKeyMap[assetType]

    const config = ASSET_VARIANTS[assetType]
    if (!config) return

    updateNodeData(nodeId, { [statusKey]: "running" })

    const results: Array<{ name: string; url: string }> = []

    try {
      for (let i = 0; i < config.variants.length; i++) {
        const variant = config.variants[i]
        const variantName = config.names[i]
        toast.info(`Generating ${assetType}... ${i + 1}/${config.variants.length} (${variantName})`)

        const { jobId } = await generateCharacterAsset({
          assetType,
          variant,
          name: data.characterName,
          description: data.description || undefined,
          gender: data.gender || undefined,
          style: data.style || undefined,
          baseOutfit: data.baseOutfit || undefined,
          sourceImageUrl: portraitUrl,
          userId: user?.id,
        })

        const imageUrl = await pollJobToCompletion(jobId)
        results.push({ name: variantName, url: imageUrl })

        // Update node data progressively so user sees images appear
        updateNodeData(nodeId, { [itemsKey]: [...results] })
      }

      updateNodeData(nodeId, { [statusKey]: "completed" })
      toast.success(`${assetType} generated: ${results.length} images`)

      // Sync updated assets to database
      const latestNode = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)
      const latestData = latestNode?.data as CharacterNodeData | undefined
      if (latestData?.characterDbId) {
        const supabaseSync = createClient()
        supabaseSync.auth.getUser().then(({ data: { user: syncUser } }: { data: { user: { id: string } | null } }) => {
          saveCharacter({
            id: latestData.characterDbId,
            userId: syncUser?.id,
            nodeId,
            projectId: projectId || undefined,
            name: latestData.characterName,
            sourceImageUrl: latestData.sourceImageUrl || undefined,
            expressions: latestData.expressions ?? [],
            poses: latestData.poses ?? [],
            lightingVariations: latestData.lightingVariations ?? [],
          }).catch(() => { /* best-effort */ })
        })
      }
    } catch (err) {
      if (err instanceof WorkflowStaleError) return
      // Keep any results generated so far
      updateNodeData(nodeId, { [statusKey]: "failed" })
      toast.error(`Failed to generate ${assetType} (${results.length}/${config.variants.length} completed)`, {
        description: err instanceof Error ? err.message : "Unknown error",
      })
    }
  }

  async function handleGenerateObjectAsset(nodeId: string, assetType: "angles" | "materials" | "variations"): Promise<void> {
    const { updateNodeData } = useWorkflowStore.getState()
    const node = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)
    if (!node) return
    const data = node.data as ObjectNodeData
    if (!data.objectName) {
      toast.error("Set an object name first")
      return
    }
    const activeResult = (data.generatedResults ?? [])[data.activeResultIndex ?? 0]
    const imageUrl = activeResult?.url ?? data.sourceImageUrl
    if (!imageUrl) {
      toast.error("Generate or upload a main image first")
      return
    }

    const statusKeyMap: Record<string, string> = { angles: "anglesStatus", materials: "materialsStatus", variations: "variationsStatus" }
    const itemsKeyMap: Record<string, string> = { angles: "angles", materials: "materials", variations: "variations" }
    const statusKey = statusKeyMap[assetType]
    const itemsKey = itemsKeyMap[assetType]

    const config = OBJECT_ASSET_VARIANTS[assetType]
    if (!config) return

    updateNodeData(nodeId, { [statusKey]: "running" })

    const results: Array<{ name: string; url: string }> = []

    try {
      for (let i = 0; i < config.variants.length; i++) {
        const variant = config.variants[i]
        const variantName = config.names[i]
        toast.info(`Generating ${assetType}... ${i + 1}/${config.variants.length} (${variantName})`)

        const { jobId } = await generateObjectAsset({
          assetType,
          variant,
          name: data.objectName,
          description: data.description || undefined,
          category: data.category || undefined,
          style: data.style || undefined,
          sourceImageUrl: imageUrl,
          userId: user?.id,
        })

        const resultUrl = await pollJobToCompletion(jobId)
        results.push({ name: variantName, url: resultUrl })

        // Update node data progressively so user sees images appear
        updateNodeData(nodeId, { [itemsKey]: [...results] })
      }

      updateNodeData(nodeId, { [statusKey]: "completed" })
      toast.success(`${assetType} generated: ${results.length} images`)

      // Sync updated assets to database
      const latestNode = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)
      const latestData = latestNode?.data as ObjectNodeData | undefined
      if (latestData?.objectDbId) {
        const supabaseObjSync = createClient()
        supabaseObjSync.auth.getUser().then(({ data: { user: objSyncUser } }: { data: { user: { id: string } | null } }) => {
          saveObject({
            id: latestData.objectDbId,
            userId: objSyncUser?.id,
            nodeId,
            projectId: projectId || undefined,
            name: latestData.objectName,
            sourceImageUrl: latestData.sourceImageUrl || undefined,
            angles: latestData.angles ?? [],
            materials: latestData.materials ?? [],
            variations: latestData.variations ?? [],
          }).catch(() => { /* best-effort */ })
        })
      }
    } catch (err) {
      if (err instanceof WorkflowStaleError) return
      // Keep any results generated so far
      updateNodeData(nodeId, { [statusKey]: "failed" })
      toast.error(`Failed to generate ${assetType} (${results.length}/${config.variants.length} completed)`, {
        description: err instanceof Error ? err.message : "Unknown error",
      })
    }
  }

  async function handleGenerateLocationAsset(nodeId: string, assetType: "timeOfDay" | "weather" | "angles"): Promise<void> {
    const { updateNodeData } = useWorkflowStore.getState()
    const node = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)
    if (!node) return
    const data = node.data as LocationNodeData
    if (!data.locationName) {
      toast.error("Set a location name first")
      return
    }
    const activeResult = (data.generatedResults ?? [])[data.activeResultIndex ?? 0]
    const imageUrl = activeResult?.url ?? data.sourceImageUrl
    if (!imageUrl) {
      toast.error("Generate or upload a main image first")
      return
    }

    const statusKeyMap: Record<string, string> = { timeOfDay: "timeOfDayStatus", weather: "weatherStatus", angles: "anglesStatus" }
    const itemsKeyMap: Record<string, string> = { timeOfDay: "timeOfDay", weather: "weather", angles: "angles" }
    const statusKey = statusKeyMap[assetType]
    const itemsKey = itemsKeyMap[assetType]

    const config = LOCATION_ASSET_VARIANTS[assetType]
    if (!config) return

    updateNodeData(nodeId, { [statusKey]: "running" })

    const results: Array<{ name: string; url: string }> = []

    try {
      for (let i = 0; i < config.variants.length; i++) {
        const variant = config.variants[i]
        const variantName = config.names[i]
        toast.info(`Generating ${assetType}... ${i + 1}/${config.variants.length} (${variantName})`)

        const { jobId } = await generateLocationAsset({
          assetType,
          variant,
          name: data.locationName,
          description: data.description || undefined,
          category: data.category || undefined,
          style: data.style || undefined,
          sourceImageUrl: imageUrl,
          userId: user?.id,
        })

        const resultUrl = await pollJobToCompletion(jobId)
        results.push({ name: variantName, url: resultUrl })

        // Update node data progressively so user sees images appear
        updateNodeData(nodeId, { [itemsKey]: [...results] })
      }

      updateNodeData(nodeId, { [statusKey]: "completed" })
      toast.success(`${assetType} generated: ${results.length} images`)

      // Sync updated assets to database
      const latestNode = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)
      const latestData = latestNode?.data as LocationNodeData | undefined
      if (latestData?.locationDbId) {
        const supabaseLocSync = createClient()
        supabaseLocSync.auth.getUser().then(({ data: { user: locSyncUser } }: { data: { user: { id: string } | null } }) => {
          saveLocation({
            id: latestData.locationDbId,
            userId: locSyncUser?.id,
            nodeId,
            projectId: projectId || undefined,
            name: latestData.locationName,
            sourceImageUrl: latestData.sourceImageUrl || undefined,
            timeOfDay: latestData.timeOfDay ?? [],
            weather: latestData.weather ?? [],
            angles: latestData.angles ?? [],
          }).catch(() => { /* best-effort */ })
        })
      }
    } catch (err) {
      if (err instanceof WorkflowStaleError) return
      // Keep any results generated so far
      updateNodeData(nodeId, { [statusKey]: "failed" })
      toast.error(`Failed to generate ${assetType} (${results.length}/${config.variants.length} completed)`, {
        description: err instanceof Error ? err.message : "Unknown error",
      })
    }
  }

  function runVideoGeneration(nodeId: string, startFrameUrl: string, endFrameUrl?: string, audioUrl?: string, provider?: string, generateAudio?: boolean, duration?: number, prompt?: string, mode?: string, sound?: boolean): Promise<void> {
    const { updateNodeData } = useWorkflowStore.getState()
    updateNodeData(nodeId, { executionStatus: "running", generatedVideoUrl: undefined, currentJobId: undefined, currentJobProgress: undefined })

    return new Promise((resolve, reject) => {
      generateVideo({
        startFrameUrl,
        endFrameUrl,
        audioUrl,
        prompt,
        provider,
        generateAudio,
        duration,
        mode,
        sound,
        userId: user?.id,
      }).then(({ jobId }) => {
        toast.info("Video generation started", { description: `Job ID: ${jobId}` })
        // Store the job ID so we can track progress
        updateNodeData(nodeId, { currentJobId: jobId })

        const poll = trackInterval(setInterval(async () => {
          if (isWorkflowStale()) { untrackInterval(poll); reject(new WorkflowStaleError()); return }
          try {
            const job = await getJobStatus(jobId)

            // Update progress if available (KIE.ai providers report progress)
            if (job.progress != null && job.progress > 0) {
              updateNodeData(nodeId, { currentJobProgress: job.progress })
            }

            if (job.status === "completed") {
              untrackInterval(poll)
              const videoUrl = job.output_data?.videoUrl
              const existingResults = ((useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)?.data) as ImageToVideoData | undefined)?.generatedResults ?? []
              const newResult: GeneratedResult = { url: videoUrl ?? "", timestamp: new Date().toISOString(), jobId }
              updateNodeData(nodeId, {
                executionStatus: "completed",
                generatedVideoUrl: videoUrl,
                generatedResults: [newResult, ...existingResults],
                activeResultIndex: 0,
                currentJobId: undefined,
                currentJobProgress: undefined,
              })
              toast.success("Video generated")
              resolve()
            } else if (job.status === "failed") {
              untrackInterval(poll)
              const errMsg = job.error_message ?? "Unknown error"
              updateNodeData(nodeId, { executionStatus: "failed", errorMessage: errMsg, currentJobId: undefined, currentJobProgress: undefined })
              toast.error("Video generation failed", { description: errMsg })
              reject(new Error(errMsg))
            }
          } catch (err) {
            untrackInterval(poll)
            updateNodeData(nodeId, { executionStatus: "failed", currentJobId: undefined, currentJobProgress: undefined })
            toast.error("Failed to check video job status")
            reject(err)
          }
        }, 2000))
      }).catch((err) => {
        updateNodeData(nodeId, { executionStatus: "failed", currentJobId: undefined, currentJobProgress: undefined })
        toast.error("Failed to start video generation", {
          description: err instanceof Error ? err.message : "Unknown error",
        })
        reject(err)
      })
    })
  }

  function runVideoToVideoGeneration(nodeId: string, sourceVideoUrl: string, prompt?: string, provider?: string): Promise<void> {
    const { updateNodeData } = useWorkflowStore.getState()
    updateNodeData(nodeId, { executionStatus: "running", generatedVideoUrl: undefined, currentJobId: undefined, currentJobProgress: undefined })

    return new Promise((resolve, reject) => {
      videoToVideo(sourceVideoUrl, prompt, provider, user?.id).then(({ jobId }) => {
        toast.info("Video-to-video generation started", { description: `Job ID: ${jobId}` })
        // Store the job ID so we can track progress
        updateNodeData(nodeId, { currentJobId: jobId })

        const poll = trackInterval(setInterval(async () => {
          if (isWorkflowStale()) { untrackInterval(poll); reject(new WorkflowStaleError()); return }
          try {
            const job = await getJobStatus(jobId)

            // Update progress if available (KIE.ai providers report progress)
            if (job.progress != null && job.progress > 0) {
              updateNodeData(nodeId, { currentJobProgress: job.progress })
            }

            if (job.status === "completed") {
              untrackInterval(poll)
              const videoUrl = job.output_data?.videoUrl
              const existingResults = ((useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)?.data) as VideoToVideoData | undefined)?.generatedResults ?? []
              const newResult: GeneratedResult = { url: videoUrl ?? "", timestamp: new Date().toISOString(), jobId }
              updateNodeData(nodeId, {
                executionStatus: "completed",
                generatedVideoUrl: videoUrl,
                generatedResults: [newResult, ...existingResults],
                activeResultIndex: 0,
                currentJobId: undefined,
                currentJobProgress: undefined,
              })
              toast.success("Video-to-video generated")
              resolve()
            } else if (job.status === "failed") {
              untrackInterval(poll)
              const errMsg = job.error_message ?? "Unknown error"
              updateNodeData(nodeId, { executionStatus: "failed", errorMessage: errMsg, currentJobId: undefined, currentJobProgress: undefined })
              toast.error("Video-to-video generation failed", { description: errMsg })
              reject(new Error(errMsg))
            }
          } catch (err) {
            untrackInterval(poll)
            updateNodeData(nodeId, { executionStatus: "failed", currentJobId: undefined, currentJobProgress: undefined })
            toast.error("Failed to check video-to-video job status")
            reject(err)
          }
        }, 2000))
      }).catch((err) => {
        updateNodeData(nodeId, { executionStatus: "failed", currentJobId: undefined, currentJobProgress: undefined })
        toast.error("Failed to start video-to-video generation", {
          description: err instanceof Error ? err.message : "Unknown error",
        })
        reject(err)
      })
    })
  }

  function runTextToVideoGeneration(nodeId: string, prompt: string, provider?: string): Promise<void> {
    const { updateNodeData } = useWorkflowStore.getState()
    updateNodeData(nodeId, { executionStatus: "running", generatedVideoUrl: undefined, currentJobId: undefined, currentJobProgress: undefined })

    return new Promise((resolve, reject) => {
      textToVideo(prompt, provider, user?.id).then(({ jobId }) => {
        toast.info("Text-to-video generation started", { description: `Job ID: ${jobId}` })
        // Store the job ID so we can track progress
        updateNodeData(nodeId, { currentJobId: jobId })

        const poll = trackInterval(setInterval(async () => {
          if (isWorkflowStale()) { untrackInterval(poll); reject(new WorkflowStaleError()); return }
          try {
            const job = await getJobStatus(jobId)

            // Update progress if available (KIE.ai providers report progress)
            if (job.progress != null && job.progress > 0) {
              updateNodeData(nodeId, { currentJobProgress: job.progress })
            }

            if (job.status === "completed") {
              untrackInterval(poll)
              const videoUrl = job.output_data?.videoUrl
              const existingResults = ((useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)?.data) as TextToVideoData | undefined)?.generatedResults ?? []
              const newResult: GeneratedResult = { url: videoUrl ?? "", timestamp: new Date().toISOString(), jobId }
              updateNodeData(nodeId, {
                executionStatus: "completed",
                generatedVideoUrl: videoUrl,
                generatedResults: [newResult, ...existingResults],
                activeResultIndex: 0,
                currentJobId: undefined,
                currentJobProgress: undefined,
              })
              toast.success("Text-to-video generated")
              resolve()
            } else if (job.status === "failed") {
              untrackInterval(poll)
              const errMsg = job.error_message ?? "Unknown error"
              updateNodeData(nodeId, { executionStatus: "failed", errorMessage: errMsg, currentJobId: undefined, currentJobProgress: undefined })
              toast.error("Text-to-video generation failed", { description: errMsg })
              reject(new Error(errMsg))
            }
          } catch (err) {
            untrackInterval(poll)
            updateNodeData(nodeId, { executionStatus: "failed", currentJobId: undefined, currentJobProgress: undefined })
            toast.error("Failed to check text-to-video job status")
            reject(err)
          }
        }, 2000))
      }).catch((err) => {
        updateNodeData(nodeId, { executionStatus: "failed", currentJobId: undefined, currentJobProgress: undefined })
        toast.error("Failed to start text-to-video generation", {
          description: err instanceof Error ? err.message : "Unknown error",
        })
        reject(err)
      })
    })
  }

  function runTextToSpeechGeneration(nodeId: string, text: string, voice?: string, provider?: string, options?: { stability?: number; similarityBoost?: number; style?: number; speed?: number; languageCode?: string }): Promise<void> {
    const { updateNodeData } = useWorkflowStore.getState()
    updateNodeData(nodeId, { executionStatus: "running" })

    return new Promise((resolve, reject) => {
      textToSpeech(text, voice, provider, user?.id, options).then(({ jobId }) => {
        toast.info("Text-to-speech generation started", { description: `Job ID: ${jobId}` })

        const poll = trackInterval(setInterval(async () => {
          if (isWorkflowStale()) { untrackInterval(poll); reject(new WorkflowStaleError()); return }
          try {
            const job = await getJobStatus(jobId)
            if (job.status === "completed") {
              untrackInterval(poll)
              const audioUrl = job.output_data?.audioUrl
              const existingResults = ((useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)?.data) as TextToSpeechData | undefined)?.generatedResults ?? []
              const newResult: GeneratedResult = { url: audioUrl ?? "", timestamp: new Date().toISOString(), jobId }
              updateNodeData(nodeId, {
                executionStatus: "completed",
                generatedAudioUrl: audioUrl,
                generatedResults: [newResult, ...existingResults],
                activeResultIndex: 0,
              })
              toast.success("Audio generated")
              resolve()
            } else if (job.status === "failed") {
              untrackInterval(poll)
              const errMsg = job.error_message ?? "Unknown error"
              updateNodeData(nodeId, { executionStatus: "failed", errorMessage: errMsg })
              toast.error("Text-to-speech generation failed", { description: errMsg })
              reject(new Error(errMsg))
            }
          } catch (err) {
            untrackInterval(poll)
            updateNodeData(nodeId, { executionStatus: "failed" })
            toast.error("Failed to check text-to-speech job status")
            reject(err)
          }
        }, 2000))
      }).catch((err) => {
        updateNodeData(nodeId, { executionStatus: "failed" })
        toast.error("Failed to start text-to-speech generation", {
          description: err instanceof Error ? err.message : "Unknown error",
        })
        reject(err)
      })
    })
  }

  function runScriptGeneration(nodeId: string, prompt: string, sceneCount?: number, tone?: string, targetDuration?: number, provider?: string): Promise<void> {
    const { updateNodeData } = useWorkflowStore.getState()
    updateNodeData(nodeId, { executionStatus: "running" })

    return new Promise((resolve, reject) => {
      generateScriptApi(prompt, sceneCount, tone, targetDuration, provider, user?.id).then(({ jobId }) => {
        toast.info("Script generation started", { description: `Job ID: ${jobId}` })

        const poll = trackInterval(setInterval(async () => {
          if (isWorkflowStale()) { untrackInterval(poll); reject(new WorkflowStaleError()); return }
          try {
            const job = await getJobStatus(jobId)
            if (job.status === "completed") {
              untrackInterval(poll)
              const script = job.output_data?.script as GeneratedScript | undefined
              const existingResults = ((useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)?.data) as GenerateScriptData | undefined)?.generatedResults ?? []
              const newResult: GeneratedScriptResult = { script: script ?? { title: "", totalDuration: 0, scenes: [] }, timestamp: new Date().toISOString(), jobId }
              updateNodeData(nodeId, {
                executionStatus: "completed",
                generatedScript: script,
                generatedResults: [newResult, ...existingResults],
                activeResultIndex: 0,
              })
              toast.success("Script generated", { description: script?.title })
              resolve()
            } else if (job.status === "failed") {
              untrackInterval(poll)
              const errMsg = job.error_message ?? "Unknown error"
              updateNodeData(nodeId, { executionStatus: "failed", errorMessage: errMsg })
              toast.error("Script generation failed", { description: errMsg })
              reject(new Error(errMsg))
            }
          } catch (err) {
            untrackInterval(poll)
            updateNodeData(nodeId, { executionStatus: "failed" })
            toast.error("Failed to check script generation status")
            reject(err)
          }
        }, 2000))
      }).catch((err) => {
        updateNodeData(nodeId, { executionStatus: "failed" })
        toast.error("Failed to start script generation", {
          description: err instanceof Error ? err.message : "Unknown error",
        })
        reject(err)
      })
    })
  }

  function runCombineVideos(nodeId: string, videoUrls: string[], transition: "cut" | "fade" | "dissolve", transitionDuration: number): Promise<void> {
    const { updateNodeData } = useWorkflowStore.getState()
    updateNodeData(nodeId, { executionStatus: "running", generatedVideoUrl: undefined })

    return new Promise((resolve, reject) => {
      combineVideos(videoUrls, transition, transitionDuration, user?.id).then(({ jobId }) => {
        toast.info("Combine videos started", { description: `Job ID: ${jobId}` })

        const poll = trackInterval(setInterval(async () => {
          if (isWorkflowStale()) { untrackInterval(poll); reject(new WorkflowStaleError()); return }
          try {
            const job = await getJobStatus(jobId)
            if (job.status === "completed") {
              untrackInterval(poll)
              const videoUrl = job.output_data?.videoUrl
              const existingResults = ((useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)?.data) as CombineVideosData | undefined)?.generatedResults ?? []
              const newResult: GeneratedResult = { url: videoUrl ?? "", timestamp: new Date().toISOString(), jobId }
              updateNodeData(nodeId, {
                executionStatus: "completed",
                generatedVideoUrl: videoUrl,
                generatedResults: [newResult, ...existingResults],
                activeResultIndex: 0,
              })
              toast.success("Videos combined")
              resolve()
            } else if (job.status === "failed") {
              untrackInterval(poll)
              const errMsg = job.error_message ?? "Unknown error"
              updateNodeData(nodeId, { executionStatus: "failed", errorMessage: errMsg })
              toast.error("Combine videos failed", { description: errMsg })
              reject(new Error(errMsg))
            }
          } catch (err) {
            untrackInterval(poll)
            updateNodeData(nodeId, { executionStatus: "failed" })
            toast.error("Failed to check combine videos status")
            reject(err)
          }
        }, 2000))
      }).catch((err) => {
        updateNodeData(nodeId, { executionStatus: "failed" })
        toast.error("Failed to start combine videos", {
          description: err instanceof Error ? err.message : "Unknown error",
        })
        reject(err)
      })
    })
  }

  function runProcessingNode(nodeId: string, apiCall: () => Promise<{ jobId: string }>, outputKey: "generatedVideoUrl" | "generatedAudioUrl", label: string, extraOutputFields?: (outputData: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
    const { updateNodeData } = useWorkflowStore.getState()
    updateNodeData(nodeId, { executionStatus: "running", [outputKey]: undefined, currentJobId: undefined, currentJobProgress: 0 })

    return new Promise((resolve, reject) => {
      apiCall().then(({ jobId }) => {
        toast.info(`${label} started`, { description: `Job ID: ${jobId}` })
        // Store the job ID on the node for progress tracking
        updateNodeData(nodeId, { currentJobId: jobId })

        const poll = trackInterval(setInterval(async () => {
          if (isWorkflowStale()) { untrackInterval(poll); reject(new WorkflowStaleError()); return }
          try {
            const job = await getJobStatus(jobId)

            // Update progress while processing
            if (job.status === "processing" && job.progress != null) {
              updateNodeData(nodeId, { currentJobProgress: job.progress })
            }

            if (job.status === "completed") {
              untrackInterval(poll)
              const url = outputKey === "generatedVideoUrl" ? job.output_data?.videoUrl : job.output_data?.audioUrl

              if (!url) {
                // If no URL returned, mark as failed
                const errMsg = "No output URL returned from job"
                updateNodeData(nodeId, { executionStatus: "failed", errorMessage: errMsg, currentJobId: undefined, currentJobProgress: undefined })
                toast.error(`${label} failed`, { description: errMsg })
                reject(new Error(errMsg))
                return
              }

              const existingResults = ((useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)?.data) as Record<string, unknown>)?.generatedResults as readonly GeneratedResult[] | undefined ?? []
              const newResult: GeneratedResult = { url: url as string, timestamp: new Date().toISOString(), jobId }
              const extraFields = extraOutputFields && job.output_data ? extraOutputFields(job.output_data as Record<string, unknown>) : {}
              updateNodeData(nodeId, {
                executionStatus: "completed",
                [outputKey]: url,
                generatedResults: [newResult, ...existingResults],
                activeResultIndex: 0,
                currentJobId: undefined,
                currentJobProgress: undefined,
                ...extraFields,
              })
              toast.success(`${label} complete`)
              resolve()
            } else if (job.status === "failed") {
              untrackInterval(poll)
              const errMsg = job.error_message ?? "Unknown error"
              updateNodeData(nodeId, { executionStatus: "failed", errorMessage: errMsg, currentJobId: undefined, currentJobProgress: undefined })
              toast.error(`${label} failed`, { description: errMsg })
              reject(new Error(errMsg))
            }
          } catch (err) {
            untrackInterval(poll)
            updateNodeData(nodeId, { executionStatus: "failed", currentJobId: undefined, currentJobProgress: undefined })
            toast.error(`Failed to check ${label} status`)
            reject(err)
          }
        }, 2000))
      }).catch((err) => {
        updateNodeData(nodeId, { executionStatus: "failed", currentJobId: undefined, currentJobProgress: undefined })
        toast.error(`Failed to start ${label}`, { description: err instanceof Error ? err.message : "Unknown error" })
        reject(err)
      })
    })
  }

  function executeNode(node: WorkflowNode): Promise<void> {
    const { nodes, edges } = useWorkflowStore.getState()
    const inputs = resolveNodeInputs(node, nodes, edges)

    if (node.type === "generate-script") {
      const prompt = inputs.prompt ?? ""
      if (!prompt) {
        toast.error(`Node "${(node.data as GenerateScriptData).label}": no prompt found`)
        return Promise.reject(new Error("No prompt"))
      }
      const scriptData = node.data as GenerateScriptData
      return runScriptGeneration(node.id, prompt, scriptData.sceneCount, scriptData.tone || undefined, scriptData.targetLength || undefined, scriptData.provider || undefined)
    }

    if (node.type === "generate-image") {
      const prompt = inputs.prompt ?? (node.data as GenerateImageData).prompt?.trim()
      if (!prompt) {
        toast.error(`Node "${(node.data as GenerateImageData).label}": no prompt found`)
        return Promise.reject(new Error("No prompt"))
      }
      const chainRefs = inputs.referenceImageUrls ?? (inputs.imageUrl ? [inputs.imageUrl] : undefined)
      const extractedRefs = (node.data as Record<string, unknown>).extractedReferenceUrls as string[] | undefined

      // Look up character definitions attached to this node
      const charIds = (node.data as GenerateImageData).characterDefinitionIds ?? []
      const allCharDefs = useWorkflowStore.getState().characterDefinitions
      const charDefs = allCharDefs.filter((c) => charIds.includes(c.id))
      const charRefUrls = charDefs.filter((c) => c.type === "reference" && c.referenceImageUrl).map((c) => c.referenceImageUrl as string)
      const userTemplates = useWorkflowStore.getState().userPromptTemplates
      const flowTemplates = useWorkflowStore.getState().flowPromptTemplates
      const charDescs = charDefs.filter((c) => c.type === "description" && c.description).map((c) => {
        const templateKey = c.category === "face" ? "face-description"
          : c.category === "location" ? "location-description"
          : c.category === "object" ? "object-description"
          : "character-description"
        const template = resolveTemplate(templateKey, userTemplates, flowTemplates)
        return applyTemplate(template, { name: c.name, description: c.description || "" })
      })

      const refImages = [...(chainRefs ?? []), ...(extractedRefs ?? []), ...charRefUrls]
      let finalPrompt: string
      if (charDescs.length > 0) {
        const wrapperTemplate = resolveTemplate("generate-image-wrapper", userTemplates, flowTemplates)
        finalPrompt = applyTemplate(wrapperTemplate, { userPrompt: prompt, assetDescriptions: charDescs.join(" ") })
      } else {
        finalPrompt = prompt
      }
      return runImageGeneration(node.id, finalPrompt, refImages.length > 0 ? refImages : undefined, (node.data as GenerateImageData).provider || undefined)
    }

    if (node.type === "edit-image") {
      // Use imageUrl if available, otherwise use first reference image as fallback
      const imageUrl = inputs.imageUrl ?? inputs.referenceImageUrls?.[0]
      if (!imageUrl) {
        toast.error(`Node "${(node.data as EditImageData).label}": no input image found`)
        return Promise.reject(new Error("No input image"))
      }
      const editData = node.data as EditImageData
      const provider = editData.provider || "recraft-upscale"
      const prompt = editData.prompt || undefined
      return runEditImage(node.id, imageUrl, prompt, provider)
    }

    if (node.type === "image-to-image") {
      // Use imageUrl if available, otherwise use first reference image as fallback
      const imageUrl = inputs.imageUrl ?? inputs.referenceImageUrls?.[0]
      if (!imageUrl) {
        toast.error(`Node "${(node.data as ImageToImageData).label}": no input image found`)
        return Promise.reject(new Error("No input image"))
      }
      const i2iData = node.data as ImageToImageData
      const prompt = i2iData.prompt
      if (!prompt) {
        toast.error(`Node "${i2iData.label}": transformation prompt is required`)
        return Promise.reject(new Error("Transformation prompt is required"))
      }
      const provider = i2iData.provider || "nano-banana"
      // Collect additional reference images (from character/location/object nodes)
      // excluding the main image to avoid duplicates
      const refUrls = inputs.referenceImageUrls?.filter(url => url !== imageUrl) ?? []
      return runImageToImage(node.id, imageUrl, prompt, provider, refUrls.length > 0 ? refUrls : undefined)
    }

    if (node.type === "image-to-video") {
      const i2vData = node.data as ImageToVideoData
      const nodeProvider = i2vData.provider

      // Resolve start frame from dedicated handle
      let startFrameUrl: string | undefined
      const startEdge = edges.find((e) => e.target === node.id && e.targetHandle === "startFrame")
      if (startEdge) {
        const startNode = nodes.find((n) => n.id === startEdge.source)
        if (startNode) startFrameUrl = extractNodeOutput(startNode)
      }
      // Fallback: legacy selectedStartFrameNodeId or generic imageUrl
      if (!startFrameUrl && i2vData.selectedStartFrameNodeId) {
        const startNode = nodes.find((n) => n.id === i2vData.selectedStartFrameNodeId)
        if (startNode) startFrameUrl = extractNodeOutput(startNode)
      }
      if (!startFrameUrl) startFrameUrl = inputs.imageUrl

      if (!startFrameUrl) {
        toast.error(`Node "${i2vData.label}": no start frame image found`)
        return Promise.reject(new Error("No start frame image"))
      }

      // Resolve end frame from dedicated handle
      let endFrameUrl: string | undefined
      const endEdge = edges.find((e) => e.target === node.id && e.targetHandle === "endFrame")
      if (endEdge) {
        const endNode = nodes.find((n) => n.id === endEdge.source)
        if (endNode) endFrameUrl = extractNodeOutput(endNode)
      }
      // Fallback: legacy selectedEndFrameNodeId
      if (!endFrameUrl && i2vData.selectedEndFrameNodeId) {
        const endNode = nodes.find((n) => n.id === i2vData.selectedEndFrameNodeId)
        if (endNode) endFrameUrl = extractNodeOutput(endNode)
      }

      // Resolve audio from dedicated handle
      let audioUrl: string | undefined
      const audioEdge = edges.find((e) => e.target === node.id && e.targetHandle === "audio")
      if (audioEdge) {
        const audioNode = nodes.find((n) => n.id === audioEdge.source)
        if (audioNode) audioUrl = extractNodeOutput(audioNode)
      }
      // Fallback: legacy selectedAudioNodeId
      if (!audioUrl && i2vData.selectedAudioNodeId) {
        const audioNode = nodes.find((n) => n.id === i2vData.selectedAudioNodeId)
        if (audioNode) audioUrl = extractNodeOutput(audioNode)
      }

      if (audioUrl && !audioUrl.startsWith("http")) audioUrl = undefined

      // Use connected Text Prompt (inputs.prompt) OR direct motionPrompt field
      const prompt = inputs.prompt ?? i2vData.motionPrompt
      const kling3Mode = (i2vData as Record<string, unknown>).kling3Mode as string | undefined
      const kling3Sound = (i2vData as Record<string, unknown>).kling3Sound as boolean | undefined
      return runVideoGeneration(node.id, startFrameUrl, endFrameUrl, audioUrl, nodeProvider || undefined, i2vData.generateAudio, i2vData.duration, prompt, kling3Mode, kling3Sound)
    }

    if (node.type === "video-to-video") {
      const sourceVideoUrl = inputs.videoUrl
      if (!sourceVideoUrl) {
        toast.error(`Node "${(node.data as VideoToVideoData).label}": no source video found`)
        return Promise.reject(new Error("No source video"))
      }
      const v2vData = node.data as VideoToVideoData
      // Use connected Text Prompt (inputs.prompt) OR direct prompt field
      const inputPrompt = typeof inputs.prompt === "string" ? inputs.prompt : undefined
      const dataPrompt = typeof v2vData.prompt === "string" ? v2vData.prompt.trim() : undefined
      const prompt = inputPrompt ?? dataPrompt
      const provider = typeof v2vData.provider === "string" ? v2vData.provider : undefined
      return runVideoToVideoGeneration(node.id, sourceVideoUrl, prompt, provider)
    }

    if (node.type === "text-to-video") {
      const prompt = (typeof inputs.prompt === "string" ? inputs.prompt : undefined) ?? (node.data as TextToVideoData).prompt?.trim()
      if (!prompt) {
        toast.error(`Node "${(node.data as TextToVideoData).label}": no prompt found`)
        return Promise.reject(new Error("No prompt"))
      }
      return runTextToVideoGeneration(node.id, prompt, (node.data as TextToVideoData).provider || undefined)
    }

    if (node.type === "text-to-speech") {
      const ttsData = node.data as TextToSpeechData
      const text = (ttsData.textSource === "direct" && ttsData.directText?.trim())
        ? ttsData.directText.trim()
        : (typeof inputs.prompt === "string" ? inputs.prompt : "")
      if (!text) {
        toast.error(`Node "${ttsData.label}": no text found`)
        return Promise.reject(new Error("No text"))
      }
      const voice = ttsData.voiceId
      const ttsOptions = {
        ...(ttsData.stability != null && { stability: ttsData.stability }),
        ...(ttsData.similarityBoost != null && { similarityBoost: ttsData.similarityBoost }),
        ...(ttsData.style != null && { style: ttsData.style }),
        ...(ttsData.speed != null && { speed: ttsData.speed }),
        ...(ttsData.languageCode && { languageCode: ttsData.languageCode }),
      }
      return runTextToSpeechGeneration(node.id, text, voice || undefined, ttsData.provider || undefined, Object.keys(ttsOptions).length > 0 ? ttsOptions : undefined)
    }

    if (node.type === "generate-music") {
      const prompt = inputs.prompt ?? (node.data as GenerateMusicData).prompt?.trim()
      if (!prompt) {
        toast.error(`Node "${(node.data as GenerateMusicData).label}": no prompt found`)
        return Promise.reject(new Error("No prompt"))
      }
      const d = node.data as GenerateMusicData
      const refUrl = inputs.audioUrl || d.referenceAudioUrl || undefined
      return runProcessingNode(node.id, () => generateMusicApi(prompt, d.provider || undefined, d.duration || undefined, d.genre || undefined, d.mood || undefined, d.instrumental, d.lyrics || undefined, refUrl, user?.id), "generatedAudioUrl", "Generate Music")
    }

    if (node.type === "text-to-audio") {
      const prompt = inputs.prompt ?? (node.data as TextToAudioData).prompt?.trim()
      if (!prompt) {
        toast.error(`Node "${(node.data as TextToAudioData).label}": no prompt found`)
        return Promise.reject(new Error("No prompt"))
      }
      const d = node.data as TextToAudioData
      const sfxOptions = d.provider === "elevenlabs-sfx" ? { loop: d.loop, promptInfluence: d.promptInfluence } : undefined
      return runProcessingNode(node.id, () => textToAudioApi(prompt, d.provider || undefined, d.duration || undefined, user?.id, sfxOptions), "generatedAudioUrl", "Text to Audio")
    }

    if (node.type === "suno-generate") {
      const d = node.data as SunoGenerateData
      const prompt = inputs.prompt ?? d.prompt?.trim()
      if (!prompt) {
        toast.error(`Node "${d.label}": no prompt found`)
        return Promise.reject(new Error("No prompt"))
      }
      const hasCustomFields = !!(d.style || d.title || d.lyrics)
      return runProcessingNode(node.id, () => sunoGenerateApi({
        prompt,
        model: d.model || undefined,
        lyrics: d.lyrics || undefined,
        style: d.style || undefined,
        title: d.title || undefined,
        negativeStyle: d.negativeStyle || undefined,
        vocalGender: d.vocalGender || undefined,
        styleWeight: d.styleWeight,
        weirdnessConstraint: d.weirdnessConstraint,
        audioWeight: d.audioWeight,
        customMode: d.customMode ?? hasCustomFields,
        instrumental: d.instrumental ?? false,
        userId: user?.id,
      }), "generatedAudioUrl", "Suno Generate", (od) => ({ sunoTrackId: od.sunoTrackId as string | undefined, sunoTaskId: od.sunoTaskId as string | undefined }))
    }

    if (node.type === "suno-cover") {
      const d = node.data as SunoCoverData
      const prompt = inputs.prompt ?? d.prompt?.trim()
      if (!prompt) {
        toast.error(`Node "${d.label}": no prompt found`)
        return Promise.reject(new Error("No prompt"))
      }
      const uploadUrl = inputs.uploadUrl ?? inputs.audioUrl ?? d.uploadUrl?.trim()
      if (!uploadUrl) {
        toast.error(`Node "${d.label}": no source audio URL found`)
        return Promise.reject(new Error("No upload URL"))
      }
      const hasCoverCustomFields = !!(d.style || d.title || d.lyrics)
      return runProcessingNode(node.id, () => sunoCoverApi({
        prompt,
        uploadUrl,
        model: d.model || undefined,
        lyrics: d.lyrics || undefined,
        style: d.style || undefined,
        title: d.title || undefined,
        negativeStyle: d.negativeStyle || undefined,
        vocalGender: d.vocalGender || undefined,
        customMode: d.customMode ?? hasCoverCustomFields,
        instrumental: d.instrumental ?? false,
        userId: user?.id,
      }), "generatedAudioUrl", "Suno Cover", (od) => ({ sunoTrackId: od.sunoTrackId as string | undefined, sunoTaskId: od.sunoTaskId as string | undefined }))
    }

    if (node.type === "suno-extend") {
      const d = node.data as SunoExtendData
      const audioId = inputs.sunoTrackId ?? d.audioId?.trim()
      if (!audioId) {
        toast.error(`Node "${d.label}": no audio ID found (connect a Suno Generate/Cover node or enter manually)`)
        return Promise.reject(new Error("No audio ID"))
      }
      return runProcessingNode(node.id, () => sunoExtendApi({
        audioId,
        defaultParamFlag: d.defaultParamFlag ?? true,
        prompt: d.prompt?.trim() || undefined,
        model: d.model || undefined,
        style: d.style || undefined,
        title: d.title || undefined,
        continueAt: d.continueAt ?? undefined,
        negativeStyle: d.negativeStyle || undefined,
        vocalGender: d.vocalGender || undefined,
        styleWeight: d.styleWeight,
        weirdnessConstraint: d.weirdnessConstraint,
        audioWeight: d.audioWeight,
        userId: user?.id,
      }), "generatedAudioUrl", "Suno Extend", (od) => ({ sunoTrackId: od.sunoTrackId as string | undefined, sunoTaskId: od.sunoTaskId as string | undefined }))
    }

    if (node.type === "suno-lyrics") {
      const d = node.data as SunoLyricsData
      const prompt = inputs.prompt ?? d.prompt?.trim()
      if (!prompt) {
        toast.error(`Node "${d.label}": no prompt found`)
        return Promise.reject(new Error("No prompt"))
      }
      const { updateNodeData } = useWorkflowStore.getState()
      updateNodeData(node.id, { executionStatus: "running", generatedText: undefined, generatedTitle: undefined, currentJobId: undefined })

      return new Promise<void>((resolve, reject) => {
        sunoLyricsApi({ prompt, userId: user?.id }).then(({ jobId }) => {
          toast.info("Lyrics generation started", { description: `Job ID: ${jobId}` })
          updateNodeData(node.id, { currentJobId: jobId })

          const poll = trackInterval(setInterval(async () => {
            if (isWorkflowStale()) { untrackInterval(poll); reject(new WorkflowStaleError()); return }
            try {
              const job = await getJobStatus(jobId)
              if (job.progress) updateNodeData(node.id, { currentJobProgress: job.progress })

              if (job.status === "completed") {
                untrackInterval(poll)
                const lyrics = (job.output_data as Record<string, unknown>)?.lyrics as Array<{ text: string; title: string }> | undefined
                const first = lyrics?.[0]
                updateNodeData(node.id, {
                  executionStatus: "completed",
                  generatedText: first?.text ?? "",
                  generatedTitle: first?.title ?? "",
                  generatedResults: lyrics?.map(l => ({ text: l.text, title: l.title, jobId })),
                  activeResultIndex: 0,
                  currentJobId: undefined,
                  currentJobProgress: undefined,
                })
                toast.success("Lyrics generation complete")
                resolve()
              } else if (job.status === "failed") {
                untrackInterval(poll)
                const errMsg = job.error_message ?? "Lyrics generation failed"
                updateNodeData(node.id, { executionStatus: "failed", errorMessage: errMsg, currentJobId: undefined, currentJobProgress: undefined })
                toast.error("Lyrics generation failed", { description: errMsg })
                reject(new Error(errMsg))
              }
            } catch (err) {
              untrackInterval(poll)
              updateNodeData(node.id, { executionStatus: "failed", currentJobId: undefined, currentJobProgress: undefined })
              toast.error("Failed to check lyrics status")
              reject(err)
            }
          }, 3000))
        }).catch((err) => {
          updateNodeData(node.id, { executionStatus: "failed", currentJobId: undefined, currentJobProgress: undefined })
          toast.error("Failed to start lyrics generation", { description: err instanceof Error ? err.message : "Unknown error" })
          reject(err)
        })
      })
    }

    if (node.type === "suno-separate") {
      const d = node.data as SunoSeparateData
      const taskId = inputs.sunoTaskId ?? d.taskId?.trim()
      const audioId = inputs.sunoTrackId ?? d.audioId?.trim()
      if (!taskId) {
        toast.error(`Node "${d.label}": no task ID found (connect a Suno Generate/Cover/Extend node or enter manually)`)
        return Promise.reject(new Error("No task ID"))
      }
      return runProcessingNode(node.id, () => sunoSeparateApi({
        taskId,
        audioId: audioId ?? taskId,
        type: d.type || "separate_vocal",
        userId: user?.id,
      }), "generatedAudioUrl", "Suno Separate", (od) => {
        const extra: Record<string, unknown> = {}
        if (od.vocalUrl) extra.vocalUrl = od.vocalUrl
        if (od.instrumentalUrl) extra.instrumentalUrl = od.instrumentalUrl
        if (od.stems) extra.stems = od.stems
        return extra
      })
    }

    if (node.type === "suno-music-video") {
      const d = node.data as SunoMusicVideoData
      const taskId = inputs.sunoTaskId ?? d.taskId?.trim()
      const audioId = inputs.sunoTrackId ?? d.audioId?.trim()
      if (!taskId || !audioId) {
        toast.error(`Node "${d.label}": missing taskId or audioId. Connect to a Suno node.`)
        return Promise.reject(new Error("Missing taskId/audioId"))
      }
      return runProcessingNode(node.id, () => sunoMusicVideoApi({
        taskId,
        audioId,
        userId: user?.id,
      }), "generatedVideoUrl", "Suno Music Video")
    }

    if (node.type === "transcribe") {
      let audioUrl = inputs.audioUrl ?? inputs.videoUrl
      if (!audioUrl) {
        toast.error(`Node "${(node.data as TranscribeData).label}": no audio/video input found`)
        return Promise.reject(new Error("No audio input"))
      }
      const d = node.data as TranscribeData
      const { updateNodeData } = useWorkflowStore.getState()
      updateNodeData(node.id, { executionStatus: "running", generatedText: undefined, currentJobId: undefined, currentJobProgress: 0 })

      // If input is a video platform URL, extract audio first
      const isVideoUrl = /(?:youtube\.com|youtu\.be|tiktok\.com|instagram\.com|twitter\.com|x\.com)/.test(audioUrl)

      const getTranscribeAudioUrl = async (): Promise<string> => {
        if (!isVideoUrl) return audioUrl as string
        toast.info("Extracting audio from video...")
        const result = await downloadYouTubeAudio(audioUrl as string)

        // Update source Video URL node with thumbnail if extracted
        if (result.thumbnailUrl) {
          const { edges, nodes: currentNodes } = useWorkflowStore.getState()
          const incomingEdge = edges.find((e) => e.target === node.id)
          if (incomingEdge) {
            const sourceNode = currentNodes.find((n) => n.id === incomingEdge.source)
            if (sourceNode?.type === "youtube-video" && !(sourceNode.data as Record<string, unknown>).thumbnailUrl) {
              updateNodeData(sourceNode.id, { thumbnailUrl: result.thumbnailUrl })
            }
          }
        }

        return result.url
      }

      return new Promise((resolve, reject) => {
        getTranscribeAudioUrl().then((resolvedAudioUrl) => {
          audioUrl = resolvedAudioUrl
          return transcribeApi(audioUrl, d.provider || undefined, d.language || undefined, user?.id)
        }).then(({ jobId }) => {
          toast.info("Transcription started", { description: `Job ID: ${jobId}` })
          updateNodeData(node.id, { currentJobId: jobId })

          const poll = trackInterval(setInterval(async () => {
            if (isWorkflowStale()) { untrackInterval(poll); reject(new WorkflowStaleError()); return }
            try {
              const job = await getJobStatus(jobId)
              if (job.status === "processing" && job.progress != null) {
                updateNodeData(node.id, { currentJobProgress: job.progress })
              }
              if (job.status === "completed") {
                untrackInterval(poll)
                const text = job.output_data?.text as string | undefined
                const language = job.output_data?.language as string | undefined ?? "unknown"
                if (!text) {
                  const errMsg = "No transcript text returned from job"
                  updateNodeData(node.id, { executionStatus: "failed", errorMessage: errMsg, currentJobId: undefined, currentJobProgress: undefined })
                  toast.error("Transcription failed", { description: errMsg })
                  reject(new Error(errMsg))
                  return
                }
                const existingResults = ((useWorkflowStore.getState().nodes.find((n) => n.id === node.id)?.data) as Record<string, unknown>)?.generatedResults as Array<{ text: string; language: string; jobId: string; timestamp: string }> | undefined ?? []
                const newResult = { text, language, jobId, timestamp: new Date().toISOString() }
                updateNodeData(node.id, {
                  executionStatus: "completed",
                  generatedText: text,
                  generatedResults: [newResult, ...existingResults],
                  activeResultIndex: 0,
                  currentJobId: undefined,
                  currentJobProgress: undefined,
                })
                toast.success("Transcription complete")
                resolve()
              } else if (job.status === "failed") {
                untrackInterval(poll)
                const errMsg = job.error_message ?? "Unknown error"
                updateNodeData(node.id, { executionStatus: "failed", errorMessage: errMsg, currentJobId: undefined, currentJobProgress: undefined })
                toast.error("Transcription failed", { description: errMsg })
                reject(new Error(errMsg))
              }
            } catch (err) {
              console.error("[transcribe] Poll error:", err)
            }
          }, 2000))
        }).catch((err: Error) => {
          updateNodeData(node.id, { executionStatus: "failed", errorMessage: err.message, currentJobId: undefined, currentJobProgress: undefined })
          toast.error("Transcription failed", { description: err.message })
          reject(err)
        })
      })
    }

    if (node.type === "lip-sync") {
      const lsData = node.data as LipSyncData

      // Resolve image from selected node
      let imageUrl: string | undefined
      if (lsData.selectedImageNodeId) {
        const imageNode = nodes.find((n) => n.id === lsData.selectedImageNodeId)
        if (imageNode) {
          imageUrl = extractNodeOutput(imageNode)
        }
      }
      // Fallback to legacy single-input behavior
      if (!imageUrl) {
        imageUrl = inputs.imageUrl
      }

      // Resolve audio from selected node
      let audioUrl: string | undefined
      if (lsData.selectedAudioNodeId) {
        const audioNode = nodes.find((n) => n.id === lsData.selectedAudioNodeId)
        if (audioNode) {
          audioUrl = extractNodeOutput(audioNode)
        }
      }
      // Fallback to legacy single-input behavior
      if (!audioUrl) {
        audioUrl = inputs.audioUrl
      }

      if (!imageUrl) {
        toast.error(`Node "${lsData.label}": no portrait image found`)
        return Promise.reject(new Error("No portrait image"))
      }
      if (!audioUrl) {
        toast.error(`Node "${lsData.label}": no audio track found`)
        return Promise.reject(new Error("No audio track"))
      }

      return runProcessingNode(
        node.id,
        () => lipSyncApi(imageUrl!, audioUrl!, lsData.prompt || "A person talking naturally", lsData.provider || undefined, lsData.resolution || undefined, user?.id),
        "generatedVideoUrl",
        "Lip Sync"
      )
    }

    if (node.type === "motion-transfer") {
      const mtData = node.data as unknown as MotionTransferData

      // Motion Transfer auto-detects input type based on source node type
      // Image-producing nodes: generate-image, upload-image, character, location, object
      // Video-producing nodes: image-to-video, text-to-video, video-to-video, upload-video
      const IMAGE_PRODUCING_TYPES = new Set(["generate-image", "upload-image", "character", "location", "object"])
      const VIDEO_PRODUCING_TYPES = new Set(["image-to-video", "text-to-video", "video-to-video", "upload-video"])

      const incomingEdges = edges.filter((e) => e.target === node.id)
      let imageUrl: string | undefined
      let videoUrl: string | undefined

      for (const edge of incomingEdges) {
        const sourceNode = nodes.find((n) => n.id === edge.source)
        if (!sourceNode) continue
        const output = extractNodeOutput(sourceNode)
        if (!output) continue

        // Auto-detect by source node type
        if (IMAGE_PRODUCING_TYPES.has(sourceNode.type || "")) {
          imageUrl = output
        } else if (VIDEO_PRODUCING_TYPES.has(sourceNode.type || "")) {
          videoUrl = output
        }
      }

      if (!imageUrl) {
        toast.error(`Node "${mtData.label}": no character image found. Connect an image node (Generate Image, Upload Image, Character, etc.)`)
        return Promise.reject(new Error("No character image"))
      }
      if (!videoUrl) {
        toast.error(`Node "${mtData.label}": no motion video found. Connect a video node (Image to Video, Upload Video, etc.)`)
        return Promise.reject(new Error("No motion video"))
      }

      return runProcessingNode(
        node.id,
        () => motionTransferApi(imageUrl!, videoUrl!, mtData.prompt || undefined, mtData.characterOrientation || undefined, mtData.resolution || undefined, user?.id),
        "generatedVideoUrl",
        "Motion Transfer"
      )
    }

    if (node.type === "video-upscale") {
      const vuData = node.data as unknown as VideoUpscaleData
      const videoUrl = inputs.videoUrl
      if (!videoUrl) {
        toast.error(`Node "${vuData.label}": no video input found`)
        return Promise.reject(new Error("No video input"))
      }

      return runProcessingNode(
        node.id,
        () => videoUpscaleApi(videoUrl, vuData.upscaleFactor || undefined, user?.id),
        "generatedVideoUrl",
        "Video Upscale"
      )
    }

    if (node.type === "combine-videos") {
      const videoUrls = inputs.videoUrls ?? []
      if (videoUrls.length < 2) {
        toast.error(`Node "${(node.data as CombineVideosData).label}": need at least 2 video inputs`)
        return Promise.reject(new Error("Need at least 2 videos"))
      }
      const combineData = node.data as CombineVideosData
      return runCombineVideos(node.id, videoUrls, combineData.transition ?? "cut", combineData.transitionDuration ?? 0.5)
    }

    if (node.type === "merge-video-audio") {
      const videoUrl = inputs.videoUrl
      const audioSources = inputs.audioSources ?? []
      if (!videoUrl) { toast.error(`Node "${(node.data as MergeVideoAudioData).label}": no video input`); return Promise.reject(new Error("No video")) }
      if (audioSources.length === 0) { toast.error(`Node "${(node.data as MergeVideoAudioData).label}": no audio input`); return Promise.reject(new Error("No audio")) }
      const d = node.data as MergeVideoAudioData
      const ts = d.trackSettings ?? {}
      const audioTracks = audioSources.map((s: { url: string; sourceNodeId: string; sourceType?: string }) => {
        const setting = ts[s.sourceNodeId]
        return {
          url: s.url,
          startTime: setting?.startTime ?? d.audioOffsets?.[s.sourceNodeId] ?? 0,
          volume: setting?.volume ?? d.voiceoverVolume ?? 100,
          sourceType: s.sourceType as "audio" | "video" | undefined,
        }
      })
      const keepOrig = d.keepOriginalAudio ?? true
      const origVol = d.originalAudioVolume ?? d.backgroundVolume ?? 30
      return runProcessingNode(node.id, () => mergeVideoAudioApi(videoUrl, audioTracks, origVol, keepOrig, user?.id), "generatedVideoUrl", "Merge Video & Audio")
    }

    if (node.type === "extract-audio") {
      const videoUrl = inputs.videoUrl
      if (!videoUrl) { toast.error(`Node "${(node.data as ExtractAudioData).label}": no video input`); return Promise.reject(new Error("No video")) }
      const d = node.data as ExtractAudioData
      return runProcessingNode(node.id, () => extractAudioApi(videoUrl, d.audioFormat, d.outputSilentVideo, user?.id), "generatedAudioUrl", "Extract Audio")
    }

    if (node.type === "trim-video") {
      const videoUrl = inputs.videoUrl
      if (!videoUrl) { toast.error(`Node "${(node.data as TrimVideoData).label}": no video input`); return Promise.reject(new Error("No video")) }
      const d = node.data as TrimVideoData
      return runProcessingNode(node.id, () => trimVideoApi(videoUrl, d.startTime, d.endTime || undefined, user?.id), "generatedVideoUrl", "Trim Video")
    }

    if (node.type === "resize-video") {
      const videoUrl = inputs.videoUrl
      if (!videoUrl) { toast.error(`Node "${(node.data as ResizeVideoData).label}": no video input`); return Promise.reject(new Error("No video")) }
      const d = node.data as ResizeVideoData
      return runProcessingNode(node.id, () => resizeVideoApi(videoUrl, d.targetAspect, d.method, d.padColor || undefined, user?.id), "generatedVideoUrl", "Resize Video")
    }

    if (node.type === "adjust-volume") {
      const videoUrl = inputs.videoUrl
      const audioUrl = inputs.audioUrl
      const inputUrl = videoUrl ?? audioUrl
      if (!inputUrl) { toast.error(`Node "${(node.data as AdjustVolumeData).label}": no audio or video input`); return Promise.reject(new Error("No input")) }
      const inputType: "video" | "audio" = videoUrl ? "video" : "audio"
      const outputKey: "generatedVideoUrl" | "generatedAudioUrl" = inputType === "video" ? "generatedVideoUrl" : "generatedAudioUrl"
      const d = node.data as AdjustVolumeData
      const { updateNodeData } = useWorkflowStore.getState()
      updateNodeData(node.id, { lastInputType: inputType })
      return runProcessingNode(node.id, () => adjustVolumeApi(inputUrl, inputType, d.volume, d.normalize, d.fadeIn, d.fadeOut, user?.id), outputKey, "Adjust Volume")
    }

    if (node.type === "add-captions") {
      const videoUrl = inputs.videoUrl
      if (!videoUrl) { toast.error(`Node "${(node.data as AddCaptionsData).label}": no video input`); return Promise.reject(new Error("No video")) }
      const d = node.data as AddCaptionsData
      const text = inputs.prompt ?? ""
      if (!text) { toast.error(`Node "${d.label}": no caption text`); return Promise.reject(new Error("No text")) }
      return runProcessingNode(node.id, () => addCaptionsApi(videoUrl, text, d.style, d.position, d.fontSize, d.color, undefined, user?.id), "generatedVideoUrl", "Add Captions")
    }

    if (node.type === "mix-audio") {
      const audioUrls = inputs.audioUrls ?? []
      if (audioUrls.length < 2) { toast.error(`Node "${(node.data as MixAudioData).label}": need at least 2 audio inputs`); return Promise.reject(new Error("Need at least 2 audio tracks")) }
      return runProcessingNode(node.id, () => mixAudioApi(audioUrls, user?.id), "generatedAudioUrl", "Mix Audio")
    }

    if (node.type === "character") {
      const charData = node.data as CharacterNodeData
      if (!charData.characterName) {
        toast.error(`Node "${charData.label}": no character name set`)
        return Promise.reject(new Error("No character name"))
      }
      return runCharacterGeneration(node.id, charData)
    }

    if (node.type === "face") {
      const faceData = node.data as FaceNodeData
      if (!faceData.faceName) {
        toast.error(`Node "${faceData.label}": no face name set`)
        return Promise.reject(new Error("No face name"))
      }
      if (!faceData.sourceImageUrl) {
        toast.error(`Node "${faceData.label}": no reference photo uploaded`)
        return Promise.reject(new Error("No reference photo"))
      }
      return runFaceGeneration(node.id, faceData)
    }

    if (node.type === "object") {
      const objData = node.data as ObjectNodeData
      if (!objData.objectName) {
        toast.error(`Node "${objData.label}": no object name set`)
        return Promise.reject(new Error("No object name"))
      }
      return runObjectGeneration(node.id, objData)
    }

    if (node.type === "location") {
      const locData = node.data as LocationNodeData
      if (!locData.locationName) {
        toast.error(`Node "${locData.label}": no location name set`)
        return Promise.reject(new Error("No location name"))
      }
      return runLocationGeneration(node.id, locData)
    }

    if (node.type === "scene") {
      const sceneData = node.data as unknown as SceneNodeDataType
      const { nodes: allNodes, edges: allEdges, characterDefinitions } = useWorkflowStore.getState()

      // Resolve inputs from connected nodes (e.g., Text Prompt)
      const inputs = resolveNodeInputs(node, allNodes, allEdges)
      const connectedPrompt = inputs.prompt ?? ""

      // Build scene prompt from scene data (cinematography, style, etc.)
      const sceneStylePrompt = buildScenePrompt(sceneData, characterDefinitions)

      // Combine: connected prompt (scene description) + scene style settings
      // The connected text should be the main scene description, style comes after
      let combinedPrompt = connectedPrompt
        ? `${connectedPrompt}. ${sceneStylePrompt}`
        : sceneStylePrompt

      if (!combinedPrompt.trim()) {
        toast.error(`Scene "${sceneData.sceneName || sceneData.label}": no scene data to generate prompt`)
        return Promise.reject(new Error("Empty scene prompt"))
      }

      // Collect reference images from all attached assets
      const allAssetIds = [
        ...sceneData.characters.map((c) => c.assetId),
        ...(sceneData.locations ?? []).map((l) => l.assetId),
        ...sceneData.objects.map((o) => o.assetId),
      ]
      const refUrls: string[] = [...(inputs.referenceImageUrls ?? [])]
      const charDescs: string[] = []
      const sceneUserTemplates = useWorkflowStore.getState().userPromptTemplates
      const sceneFlowTemplates = useWorkflowStore.getState().flowPromptTemplates
      for (const assetId of allAssetIds) {
        const asset = characterDefinitions.find((a) => a.id === assetId)
        if (asset?.referenceImageUrl) refUrls.push(asset.referenceImageUrl)
        if (asset?.type === "description" && asset.description) {
          const templateKey = asset.category === "face" ? "face-description"
            : asset.category === "location" ? "location-description"
            : asset.category === "object" ? "object-description"
            : "character-description"
          const template = resolveTemplate(templateKey, sceneUserTemplates, sceneFlowTemplates)
          charDescs.push(applyTemplate(template, { name: asset.name, description: asset.description }))
        }
      }
      const finalPrompt = charDescs.length > 0 ? `${combinedPrompt}\n${charDescs.join(" ")}` : combinedPrompt
      const sceneAspectRatio = (sceneData as Record<string, unknown>).aspectRatio as string | undefined
      return runImageGeneration(node.id, finalPrompt, refUrls.length > 0 ? refUrls : undefined, undefined, sceneAspectRatio)
    }

    return Promise.resolve()
  }

  // --- Main workflow execution ---

  async function handleRun() {
    const { nodes, edges } = useWorkflowStore.getState()

    const executableNodes = nodes.filter(isExecutableNode)
    if (executableNodes.length === 0) {
      toast.error("No executable nodes found. Add Generate Image, Image to Video, or Video to Video nodes.")
      return
    }

    // Credit check before workflow execution (cloud edition only)
    if (hasCredits()) {
      try {
        const supabase = createClient()
        const { data: { user: authUser } } = await supabase.auth.getUser()
        if (authUser) {
          const { data: balance } = await getUserCredits(authUser.id)
          const estimatedCost = executableNodes.reduce((sum, node) => {
            const data = node.data as Record<string, unknown>
            const provider = data.provider as string | undefined
            if (provider) {
              const cached = getCachedCredits(provider)
              if (cached !== undefined) return sum + cached
            }
            return sum + (NODE_CREDIT_COSTS[node.type ?? ""] ?? 1)
          }, 0)
          if (balance.total < estimatedCost) {
            setInsufficientCreditsData({
              required: estimatedCost,
              available: balance.total,
              tier: balance.tier,
            })
            setShowInsufficientCredits(true)
            return
          }
        }
      } catch (err) {
        console.warn("[workflow] Credit check failed, proceeding anyway:", err)
      }
    }

    const levels = buildExecutionLevels(nodes, edges)

    setIsRunning(true)
    toast.info("Executing workflow...", { description: `${executableNodes.length} node(s) to run` })

    let failed = false
    for (const level of levels) {
      if (failed) break

      const toRun = level.filter(isExecutableNode)
      if (toRun.length === 0) continue

      const results = await Promise.allSettled(
        toRun.map((node) => executeNode(node))
      )

      const hasRealError = results.some(
        (r) => r.status === "rejected" && !(r.reason instanceof WorkflowStaleError)
      )
      const hasStaleError = results.some(
        (r) => r.status === "rejected" && r.reason instanceof WorkflowStaleError
      )
      if (hasStaleError) break // Workflow changed -- stop silently
      if (hasRealError) {
        failed = true
      }
    }

    if (pollIntervalsRef.current.size === 0) {
      setIsRunning(false)
    }

    if (failed) {
      toast.error("Workflow execution stopped due to errors")
    } else if (!isWorkflowStale()) {
      toast.success("Workflow execution complete")
    }
  }

  function handleRunSingleNode(nodeId: string) {
    const { nodes, edges } = useWorkflowStore.getState()
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return

    if (!isExecutableNode(node)) {
      toast.error("This node type cannot be run individually.")
      return
    }

    setIsRunning(true)
    executeNode(node).catch(() => {
      // Error already handled via toast in executeNode
    }).finally(() => {
      if (pollIntervalsRef.current.size === 0) {
        setIsRunning(false)
      }
    })
  }

  // Generate image for a single scene within a generate-script node
  function updateSceneInScript(
    scriptNodeId: string,
    sceneIndex: number,
    patch: Partial<{ imageStatus: "idle" | "running" | "completed" | "failed"; generatedImages: readonly SceneImageVersion[]; activeImageIndex: number }>,
  ) {
    const { nodes, updateNodeData } = useWorkflowStore.getState()
    const node = nodes.find((n) => n.id === scriptNodeId)
    if (!node) return
    const data = node.data as GenerateScriptData
    const script = data.generatedScript
    if (!script) return

    const updatedScenes = script.scenes.map((s, i) =>
      i === sceneIndex ? { ...s, ...patch } : s
    )
    const updatedScript: GeneratedScript = { ...script, scenes: updatedScenes }
    const results = data.generatedResults ?? []
    const activeIdx = data.activeResultIndex ?? 0
    const updatedResults = results.map((r, i) =>
      i === activeIdx ? { ...r, script: updatedScript } : r
    )
    updateNodeData(scriptNodeId, { generatedScript: updatedScript, generatedResults: updatedResults })
  }

  async function handleGenerateSceneImage(scriptNodeId: string, sceneIndex: number): Promise<void> {
    const { nodes } = useWorkflowStore.getState()
    const node = nodes.find((n) => n.id === scriptNodeId)
    if (!node) return

    const scriptData = node.data as GenerateScriptData
    const script = scriptData.generatedScript
    if (!script || !script.scenes[sceneIndex]) return

    const scene = script.scenes[sceneIndex]

    // Block generation if description-only characters need references from earlier scenes
    const allCharDefs0 = useWorkflowStore.getState().characterDefinitions
    const sceneCharNames0 = getSceneCharacterNames(scene.characters)
    for (const charName of sceneCharNames0) {
      const charDef = allCharDefs0.find((c) => c.name === charName)
      if (charDef && charDef.type === "description" && !charDef.referenceImageUrl) {
        // Find earliest scene using this character
        const earliestScene = script.scenes.findIndex((s, idx) =>
          idx !== sceneIndex && getSceneCharacterNames(s.characters).includes(charName)
        )
        if (earliestScene !== -1 && earliestScene < sceneIndex) {
          toast.error(`Generate Scene ${earliestScene + 1} first`, {
            description: `Save a reference for "${charName}" before generating this scene`,
          })
          return
        }
      }
    }

    // Collect extracted reference images for this scene
    const extractedRefs = script.extractedReferences ?? []
    const sceneChars = new Set(getSceneCharacterNames(scene.characters))
    const refUrls = extractedRefs
      .filter((r) => r.sourceSceneIndex !== sceneIndex && sceneChars.has(r.name))
      .map((r) => r.imageUrl)

    // Collect workflow-level character definitions matching scene characters
    const allCharDefs = useWorkflowStore.getState().characterDefinitions
    const sceneCharDefs = allCharDefs.filter((c) => sceneChars.has(c.name))
    const charRefUrls = sceneCharDefs
      .filter((c) => c.type === "reference" && c.referenceImageUrl)
      .map((c) => c.referenceImageUrl as string)
    const userTemplates = useWorkflowStore.getState().userPromptTemplates
    const flowTemplates = useWorkflowStore.getState().flowPromptTemplates
    const charDescs = sceneCharDefs
      .filter((c) => c.type === "description" && c.description)
      .map((c) => {
        const templateKey = c.category === "face" ? "face-description"
          : c.category === "location" ? "location-description"
          : c.category === "object" ? "object-description"
          : "character-description"
        const template = resolveTemplate(templateKey, userTemplates, flowTemplates)
        return applyTemplate(template, { name: c.name, description: c.description || "" })
      })

    const allRefImages = [...refUrls, ...charRefUrls]
    let finalPrompt: string
    if (charDescs.length > 0) {
      const wrapperTemplate = resolveTemplate("generate-image-wrapper", userTemplates, flowTemplates)
      finalPrompt = applyTemplate(wrapperTemplate, { userPrompt: scene.imagePrompt, assetDescriptions: charDescs.join(" ") })
    } else {
      finalPrompt = scene.imagePrompt
    }

    updateSceneInScript(scriptNodeId, sceneIndex, { imageStatus: "running" })

    try {
      const { jobId } = await generateImage(finalPrompt, allRefImages.length > 0 ? allRefImages : undefined, undefined, undefined, undefined, user?.id)

      await new Promise<void>((resolve, reject) => {
        const poll = trackInterval(setInterval(async () => {
          if (isWorkflowStale()) { untrackInterval(poll); reject(new WorkflowStaleError()); return }
          try {
            const job = await getJobStatus(jobId)
            if (job.status === "completed") {
              untrackInterval(poll)
              const imageUrl = (job.output_data?.imageUrl as string | undefined) ?? ""

              // Read latest scene data for existing versions
              const latestNode = useWorkflowStore.getState().nodes.find((n) => n.id === scriptNodeId)
              const latestScene = (latestNode?.data as GenerateScriptData | undefined)?.generatedScript?.scenes[sceneIndex]
              const existing = latestScene?.generatedImages ?? []
              const newVersion: SceneImageVersion = { url: imageUrl, timestamp: new Date().toISOString(), jobId }
              const newImages = [newVersion, ...existing].slice(0, 5)

              updateSceneInScript(scriptNodeId, sceneIndex, {
                imageStatus: "completed",
                generatedImages: newImages,
                activeImageIndex: 0,
              })

              resolve()
            } else if (job.status === "failed") {
              untrackInterval(poll)
              updateSceneInScript(scriptNodeId, sceneIndex, { imageStatus: "failed" })
              reject(new Error(job.error_message ?? "Image generation failed"))
            }
          } catch (err) {
            untrackInterval(poll)
            reject(err)
          }
        }, 2000))
      })
    } catch (err) {
      if (err instanceof WorkflowStaleError) return
      // Mark scene as failed if still running
      const latestNode = useWorkflowStore.getState().nodes.find((n) => n.id === scriptNodeId)
      const latestScene = (latestNode?.data as GenerateScriptData | undefined)?.generatedScript?.scenes[sceneIndex]
      if (latestScene?.imageStatus === "running") {
        updateSceneInScript(scriptNodeId, sceneIndex, { imageStatus: "failed" })
      }
      throw err
    }
  }

  function handleExpandToSceneNodes(
    scriptNodeId: string,
    options: { layout: "horizontal" | "vertical"; autoRun: boolean },
  ) {
    const store = useWorkflowStore.getState()
    const scriptNode = store.nodes.find((n) => n.id === scriptNodeId)
    if (!scriptNode) return

    const scriptData = scriptNode.data as GenerateScriptData
    const activeIdx = scriptData.activeResultIndex ?? 0
    const results = scriptData.generatedResults ?? []
    const script = results[activeIdx]?.script ?? scriptData.generatedScript
    if (!script) return

    const scenes = script.scenes
    const startX = scriptNode.position.x + 400
    const startY = scriptNode.position.y
    const isHorizontal = options.layout === "horizontal"

    const newNodes: WorkflowNode[] = []
    const newEdges: WorkflowEdge[] = []

    let idCounter = store.nodes.reduce((max, n) => {
      const num = parseInt(n.id.replace("node_", ""), 10)
      return isNaN(num) ? max : Math.max(max, num)
    }, 0) + 1

    const sceneDefaults = NODE_DEFINITIONS.find((d) => d.type === "scene")?.defaultData as SceneNodeDataType | undefined

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i]
      const mapped = mapScriptSceneToNodeData(scene)
      const images = scene.generatedImages ?? []

      const nodeId = `node_${idCounter}`
      idCounter += 1

      const posX = isHorizontal ? startX + i * 350 : startX
      const posY = isHorizontal ? startY : startY + i * 300

      const nodeData: SceneNodeDataType = {
        ...(sceneDefaults ?? {} as SceneNodeDataType),
        ...mapped,
        label: `Scene ${scene.sceneNumber}`,
        sceneNumber: scene.sceneNumber,
        sourceScriptNodeId: scriptNodeId,
        sourceSceneIndex: i,
        autoSyncWithScript: true,
        fieldMappings: {},
      }

      if (images.length > 0) {
        nodeData.executionStatus = "completed"
        nodeData.generatedImageUrl = images[scene.activeImageIndex ?? 0]?.url ?? ""
        nodeData.generatedResults = images.map((img) => ({
          url: img.url,
          timestamp: img.timestamp,
          jobId: img.jobId,
        }))
        nodeData.activeResultIndex = scene.activeImageIndex ?? 0
      }

      newNodes.push({
        id: nodeId,
        type: "scene",
        position: { x: posX, y: posY },
        data: nodeData,
      } as WorkflowNode)

      newEdges.push({
        id: `edge_${Date.now()}_script_scene_${i}`,
        source: scriptNodeId,
        sourceHandle: "scenes",
        target: nodeId,
        targetHandle: "in",
      } as WorkflowEdge)
    }

    store.batchAddNodesAndEdges(newNodes, newEdges)
    toast.success(`Created ${scenes.length} Scene Nodes`)

    // Auto-run: generate images for scenes without existing images
    if (options.autoRun) {
      for (let i = 0; i < scenes.length; i++) {
        const hasImage = (scenes[i].generatedImages ?? []).length > 0
        if (!hasImage) {
          store.runSingleNode?.(newNodes[i].id)
        }
      }
    }
  }

  function handleExpandStoryboard(
    scriptNodeId: string,
    options: { layout: "horizontal" | "vertical"; autoRun: boolean; includeCombine: boolean; narrationSource?: "visualDescription" | "action" | "imagePrompt"; nodeType?: "pipeline" | "scene" },
  ) {
    if (options.nodeType === "scene") {
      handleExpandToSceneNodes(scriptNodeId, options)
      return
    }
    const store = useWorkflowStore.getState()
    const scriptNode = store.nodes.find((n) => n.id === scriptNodeId)
    if (!scriptNode) return

    const scriptData = scriptNode.data as GenerateScriptData
    const activeIdx = scriptData.activeResultIndex ?? 0
    const results = scriptData.generatedResults ?? []
    const script = results[activeIdx]?.script ?? scriptData.generatedScript
    if (!script) return

    const scenes = script.scenes
    const startX = scriptNode.position.x + 400
    const startY = scriptNode.position.y
    const narrationSource = options.narrationSource ?? "visualDescription"

    const newNodes: WorkflowNode[] = []
    const newEdges: WorkflowEdge[] = []

    let idCounter = store.nodes.reduce((max, n) => {
      const num = parseInt(n.id.replace("node_", ""), 10)
      return isNaN(num) ? max : Math.max(max, num)
    }, 0) + 1

    function nextId(): string {
      const id = `node_${idCounter}`
      idCounter += 1
      return id
    }

    const isHorizontal = options.layout === "horizontal"

    const imageNodeIds: string[] = []
    const mergeNodeIds: string[] = []

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i]
      const images = scene.generatedImages ?? []
      const hasImage = images.length > 0

      // Get narration text based on selected source
      const narrationText = scene[narrationSource] ?? scene.visualDescription

      // Calculate positions
      let textX: number, textY: number
      let imgX: number, imgY: number
      let vidX: number, vidY: number
      let ttsX: number, ttsY: number
      let mergeX: number, mergeY: number

      if (isHorizontal) {
        const colX = startX + i * 350
        textX = colX - 60; textY = startY + 300
        imgX = colX; imgY = startY
        vidX = colX - 60; vidY = startY + 150
        ttsX = colX + 60; ttsY = startY + 300
        mergeX = colX; mergeY = startY + 450
      } else {
        // Each scene is an independent vertical block with fixed internal layout
        // Scenes stack top-to-bottom with SCENE_HEIGHT spacing (no overlap)
        const SCENE_HEIGHT = 450
        const baseY = startY + i * SCENE_HEIGHT

        // Row 1: Generate Image (left) + Image to Video (right)
        imgX = startX; imgY = baseY
        vidX = startX + 300; vidY = baseY

        // Row 2: Text Prompt (left) + Text to Speech (center) + Merge (right)
        textX = startX; textY = baseY + 200
        ttsX = startX + 300; ttsY = baseY + 200
        mergeX = startX + 600; mergeY = baseY + 100
      }

      // 1. Text Prompt (narration for TTS)
      const textNodeId = nextId()
      newNodes.push({
        id: textNodeId,
        type: "text-prompt",
        position: { x: textX, y: textY },
        data: {
          label: `Scene ${scene.sceneNumber} Narration`,
          text: narrationText,
          variables: {},
        },
      } as WorkflowNode)

      // 2. Generate Image
      const imageNodeId = nextId()
      imageNodeIds.push(imageNodeId)
      newNodes.push({
        id: imageNodeId,
        type: "generate-image",
        position: { x: imgX, y: imgY },
        data: {
          label: `Scene ${scene.sceneNumber} Image`,
          prompt: scene.imagePrompt,
          provider: "nano-banana",
          model: "gemini-2.5-flash-image",
          style: "",
          aspectRatio: "16:9",
          negativePrompt: "",
          fieldMappings: {},
          ...(hasImage ? {
            executionStatus: "completed",
            generatedImageUrl: images[scene.activeImageIndex ?? 0]?.url,
            generatedResults: images.map((img) => ({
              url: img.url,
              timestamp: img.timestamp,
              jobId: img.jobId,
            })),
            activeResultIndex: scene.activeImageIndex ?? 0,
          } : {}),
        },
      } as WorkflowNode)

      // 3. Image to Video
      const videoNodeId = nextId()
      newNodes.push({
        id: videoNodeId,
        type: "image-to-video",
        position: { x: vidX, y: vidY },
        data: {
          label: `Scene ${scene.sceneNumber} Video`,
          provider: "veo3",
          model: "veo-3.1",
          duration: scene.durationHint,
          motion: "moderate",
          cameraMotion: "static",
          fieldMappings: {},
        },
      } as WorkflowNode)

      // 4. Text to Speech
      const ttsNodeId = nextId()
      newNodes.push({
        id: ttsNodeId,
        type: "text-to-speech",
        position: { x: ttsX, y: ttsY },
        data: {
          label: `Scene ${scene.sceneNumber} Voice`,
          provider: "elevenlabs-turbo",
          voiceId: "Rachel",
          language: "en",
          speed: 1,
          stability: 0.5,
          similarityBoost: 0.75,
          style: 0,
          languageCode: "",
          fieldMappings: {},
        },
      } as WorkflowNode)

      // 5. Merge Video & Audio
      const mergeNodeId = nextId()
      mergeNodeIds.push(mergeNodeId)
      newNodes.push({
        id: mergeNodeId,
        type: "merge-video-audio",
        position: { x: mergeX, y: mergeY },
        data: {
          label: `Scene ${scene.sceneNumber} Merge`,
          audioType: "voiceover",
          voiceoverVolume: 100,
          backgroundVolume: 30,
          fieldMappings: {},
        },
      } as WorkflowNode)

      // Edges: Text Prompt → TTS
      newEdges.push({
        id: `edge_${Date.now()}_${i}_txt_tts`,
        source: textNodeId,
        sourceHandle: "prompt",
        target: ttsNodeId,
        targetHandle: "in",
      } as WorkflowEdge)

      // Edges: Generate Image → Image to Video (start frame)
      newEdges.push({
        id: `edge_${Date.now()}_${i}_img_vid`,
        source: imageNodeId,
        sourceHandle: "image",
        target: videoNodeId,
        targetHandle: "startFrame",
      } as WorkflowEdge)

      // Edges: Image to Video → Merge (video)
      newEdges.push({
        id: `edge_${Date.now()}_${i}_vid_merge`,
        source: videoNodeId,
        sourceHandle: "video",
        target: mergeNodeId,
        targetHandle: "in",
      } as WorkflowEdge)

      // Edges: TTS → Merge (audio)
      newEdges.push({
        id: `edge_${Date.now()}_${i}_tts_merge`,
        source: ttsNodeId,
        sourceHandle: "audio",
        target: mergeNodeId,
        targetHandle: "in",
      } as WorkflowEdge)
    }

    // Reference chain: connect Generate Image nodes for same characters
    const charSceneMap: Record<string, number[]> = {}
    for (let i = 0; i < scenes.length; i++) {
      for (const char of getSceneCharacterNames(scenes[i].characters)) {
        const arr = charSceneMap[char] ?? []
        arr.push(i)
        charSceneMap[char] = arr
      }
    }
    const connectedPairs = new Set<string>()
    for (const indices of Object.values(charSceneMap)) {
      for (let j = 1; j < indices.length; j++) {
        const pairKey = `${indices[j - 1]}_${indices[j]}`
        if (!connectedPairs.has(pairKey)) {
          connectedPairs.add(pairKey)
          newEdges.push({
            id: `edge_${Date.now()}_ref_${indices[j - 1]}_${indices[j]}`,
            source: imageNodeIds[indices[j - 1]],
            sourceHandle: "image",
            target: imageNodeIds[indices[j]],
            targetHandle: "in",
          } as WorkflowEdge)
        }
      }
    }

    // Inject extracted reference images into Generate Image nodes
    const extractedRefs = script.extractedReferences ?? []
    if (extractedRefs.length > 0) {
      for (let i = 0; i < scenes.length; i++) {
        const sceneChars = new Set(getSceneCharacterNames(scenes[i].characters))
        const matchingRefs = extractedRefs.filter(
          (r) => r.sourceSceneIndex !== i && sceneChars.has(r.name),
        )
        if (matchingRefs.length > 0) {
          const imgNode = newNodes.find((n) => n.id === imageNodeIds[i])
          if (imgNode) {
            const existingUrls: string[] = (imgNode.data as Record<string, unknown>).extractedReferenceUrls as string[] ?? []
            ;(imgNode.data as Record<string, unknown>).extractedReferenceUrls = [
              ...existingUrls,
              ...matchingRefs.map((r) => r.imageUrl),
            ]
          }
        }
      }
    }

    // Combine Videos: connect from Merge nodes
    if (options.includeCombine && scenes.length > 1) {
      const combineNodeId = nextId()
      const combineX = isHorizontal
        ? startX + scenes.length * 350 + 100
        : startX + 900
      const combineY = isHorizontal
        ? startY + 450
        : startY + ((scenes.length - 1) * 450) / 2

      newNodes.push({
        id: combineNodeId,
        type: "combine-videos",
        position: { x: combineX, y: combineY },
        data: {
          label: "Combine All Videos",
          transition: "cut",
          transitionDuration: 0.5,
          fieldMappings: {},
        },
      } as WorkflowNode)

      for (let i = 0; i < mergeNodeIds.length; i++) {
        newEdges.push({
          id: `edge_${Date.now()}_${i}_merge_comb`,
          source: mergeNodeIds[i],
          sourceHandle: "video",
          target: combineNodeId,
          targetHandle: "in",
        } as WorkflowEdge)
      }
    }

    store.batchAddNodesAndEdges(newNodes, newEdges)

    const totalNodes = scenes.length * 5 + (options.includeCombine && scenes.length > 1 ? 1 : 0)
    toast.success(`Created ${totalNodes} nodes for ${scenes.length} scenes`)

    // Auto-run: generate images for scenes without existing images
    if (options.autoRun) {
      for (let i = 0; i < scenes.length; i++) {
        const hasImage = (scenes[i].generatedImages ?? []).length > 0
        if (!hasImage) {
          // Each scene produces 5 nodes; Generate Image is the 2nd node (index 1) in each group
          const imageNode = newNodes[i * 5 + 1]
          if (imageNode) {
            store.runSingleNode?.(imageNode.id)
          }
        }
      }
    }
  }

  function handleCreateSceneNode(scriptNodeId: string, sceneIndex: number) {
    const store = useWorkflowStore.getState()
    const scriptNode = store.nodes.find((n) => n.id === scriptNodeId)
    if (!scriptNode) return

    const scriptData = scriptNode.data as GenerateScriptData
    const activeIdx = scriptData.activeResultIndex ?? 0
    const results = scriptData.generatedResults ?? []
    const script = results[activeIdx]?.script ?? scriptData.generatedScript
    if (!script || !script.scenes[sceneIndex]) return

    const scene = script.scenes[sceneIndex]
    const sceneDefaults = NODE_DEFINITIONS.find((d) => d.type === "scene")?.defaultData as SceneNodeDataType | undefined
    const mapped = mapScriptSceneToNodeData(scene)

    // Build node data
    const nodeData: SceneNodeDataType = {
      ...(sceneDefaults ?? {} as SceneNodeDataType),
      ...mapped,
      label: `Scene ${scene.sceneNumber}`,
      sceneNumber: scene.sceneNumber,
      sourceScriptNodeId: scriptNodeId,
      sourceSceneIndex: sceneIndex,
      autoSyncWithScript: true,
      fieldMappings: {},
    }

    // Copy generated image if available
    const images = scene.generatedImages ?? []
    if (images.length > 0) {
      nodeData.executionStatus = "completed"
      nodeData.generatedImageUrl = images[scene.activeImageIndex ?? 0]?.url ?? ""
      nodeData.generatedResults = images.map((img) => ({
        url: img.url,
        timestamp: img.timestamp,
        jobId: img.jobId,
      }))
      nodeData.activeResultIndex = scene.activeImageIndex ?? 0
    }

    // Position to the right of the script node
    const posX = scriptNode.position.x + 400
    const posY = scriptNode.position.y + sceneIndex * 300

    let idCounter = store.nodes.reduce((max, n) => {
      const num = parseInt(n.id.replace("node_", ""), 10)
      return isNaN(num) ? max : Math.max(max, num)
    }, 0) + 1
    const newNodeId = `node_${idCounter}`

    const newNode: WorkflowNode = {
      id: newNodeId,
      type: "scene",
      position: { x: posX, y: posY },
      data: nodeData,
    } as WorkflowNode

    const newEdge: WorkflowEdge = {
      id: `edge_${Date.now()}_script_scene_${sceneIndex}`,
      source: scriptNodeId,
      sourceHandle: "scenes",
      target: newNodeId,
      targetHandle: "in",
    } as WorkflowEdge

    store.batchAddNodesAndEdges([newNode], [newEdge])
    store.selectNode(newNodeId)
    store.setAutoOpenEditorNodeId(newNodeId)
    toast.success(`Created Scene Node for Scene ${scene.sceneNumber}`)
  }

  // Register single-node runner
  useEffect(() => {
    useWorkflowStore.getState().setRunSingleNode(handleRunSingleNode)
    return () => useWorkflowStore.getState().setRunSingleNode(null)
  })

  // Register scene image generator
  useEffect(() => {
    useWorkflowStore.getState().setGenerateSceneImage(handleGenerateSceneImage)
    return () => useWorkflowStore.getState().setGenerateSceneImage(null)
  })

  // Register expand storyboard
  useEffect(() => {
    useWorkflowStore.getState().setExpandStoryboard(handleExpandStoryboard)
    return () => useWorkflowStore.getState().setExpandStoryboard(null)
  })

  // Register create scene node from script
  useEffect(() => {
    useWorkflowStore.getState().setCreateSceneNodeFromScript(handleCreateSceneNode)
    return () => useWorkflowStore.getState().setCreateSceneNodeFromScript(null)
  })

  // Register character asset generator
  useEffect(() => {
    useWorkflowStore.getState().setGenerateCharacterAssetFn(handleGenerateCharacterAsset)
    return () => useWorkflowStore.getState().setGenerateCharacterAssetFn(null)
  })

  // Register object asset generator
  useEffect(() => {
    useWorkflowStore.getState().setGenerateObjectAssetFn(handleGenerateObjectAsset)
    return () => useWorkflowStore.getState().setGenerateObjectAssetFn(null)
  })

  // Register location asset generator
  useEffect(() => {
    useWorkflowStore.getState().setGenerateLocationAssetFn(handleGenerateLocationAsset)
    return () => useWorkflowStore.getState().setGenerateLocationAssetFn(null)
  })

  // Ctrl+S keyboard shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault()
        handleSave()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handleSave])

  // Browser beforeunload warning
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      const isDirty = useWorkflowStore.getState().isDirty
      if (!isDirty) return
      e.preventDefault()
    }

    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [])

  // Navigation guard for in-app navigation
  const navigateWithGuard = useCallback(
    (href: string) => {
      const isDirty = useWorkflowStore.getState().isDirty
      if (!isDirty) {
        router.push(href)
        return
      }
      pendingNavRef.current = href
      setShowUnsavedDialog(true)
    },
    [router],
  )

  function handleDialogSave() {
    setShowUnsavedDialog(false)
    handleSave().then(() => {
      if (pendingNavRef.current) {
        router.push(pendingNavRef.current)
        pendingNavRef.current = null
      }
    })
  }

  function handleDialogDiscard() {
    setShowUnsavedDialog(false)
    useWorkflowStore.getState().markClean()
    if (pendingNavRef.current) {
      router.push(pendingNavRef.current)
      pendingNavRef.current = null
    }
  }

  function handleDialogCancel() {
    setShowUnsavedDialog(false)
    pendingNavRef.current = null
  }

  return (
    <div className="flex flex-col h-screen">
      <EditorToolbar
        projectId={projectId}
        workflowId={workflowId}
        onSave={handleSave}
        saving={saving}
        onNavigate={navigateWithGuard}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {/* Main content area with floating tabs */}
      <div className="flex-1 relative">
        {/* Floating tabs overlapping header/canvas border */}
        <div className="absolute -top-5 left-1/2 -translate-x-1/2 z-50 pointer-events-auto">
          <div className="flex items-center gap-0 bg-white dark:bg-[#1E1E1E] rounded-lg px-1 border border-gray-200 dark:border-[#2D2D2D] shadow-lg">
            <button
              type="button"
              onClick={() => setActiveTab("editor")}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                activeTab === "editor"
                  ? "text-[#ff0073] border-[#ff0073]"
                  : "text-[#64748B] dark:text-gray-400 border-transparent hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              <Layers className="w-4 h-4" />
              Editor
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("executions")}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                activeTab === "executions"
                  ? "text-[#ff0073] border-[#ff0073]"
                  : "text-[#64748B] dark:text-gray-400 border-transparent hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              <History className="w-4 h-4" />
              Executions
              {activeJobCount > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-xs font-medium bg-[#ff0073] text-white rounded-full">
                  {activeJobCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("cost")}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                activeTab === "cost"
                  ? "text-[#ff0073] border-[#ff0073]"
                  : "text-[#64748B] dark:text-gray-400 border-transparent hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              <DollarSign className="w-4 h-4" />
              Cost
            </button>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === "editor" && (
          <div className="absolute inset-0">
            <ReactFlowProvider>
              <WorkflowCanvas
                sidebarVisible={sidebarVisible}
                onToggleSidebar={() => setSidebarVisible((v) => !v)}
              />
              <NodeToolbar visible={sidebarVisible} />
              <ConfigPanel />
            </ReactFlowProvider>
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2">
              {isRunning ? (
                <>
                  <Button
                    size="lg"
                    onClick={handleStop}
                    className="rounded-full px-6 text-white"
                    style={{ backgroundColor: '#ff0073' }}
                  >
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Executing workflow
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleStop}
                    title="Stop current execution"
                    className="rounded-lg bg-background"
                  >
                    <Square className="w-4 h-4" />
                  </Button>
                </>
              ) : (
                <Button
                  size="lg"
                  onClick={handleRun}
                  className="rounded-full px-6 text-white hover:opacity-90"
                  style={{ backgroundColor: '#ff0073' }}
                >
                  <Play className="w-4 h-4 mr-2" />
                  Execute workflow
                  {hasCredits() && workflowCreditEstimate > 0 && (
                    <span className="ml-2 opacity-80">({workflowCreditEstimate} CR)</span>
                  )}
                </Button>
              )}
            </div>
          </div>
        )}

        {activeTab === "executions" && (
          <div className="absolute inset-0">
            <ExecutionsTab className="h-full" />
          </div>
        )}

        {activeTab === "cost" && (
          <div className="absolute inset-0">
            <CostTab className="h-full" />
          </div>
        )}
      </div>

      <UnsavedChangesDialog
        open={showUnsavedDialog}
        onSave={handleDialogSave}
        onDiscard={handleDialogDiscard}
        onCancel={handleDialogCancel}
      />

      <InsufficientCreditsModal
        open={showInsufficientCredits}
        onClose={() => setShowInsufficientCredits(false)}
        required={insufficientCreditsData?.required ?? 0}
        available={insufficientCreditsData?.available ?? 0}
        tier={insufficientCreditsData?.tier ?? "free"}
      />
    </div>
  )
}
