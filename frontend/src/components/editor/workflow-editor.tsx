"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ReactFlowProvider } from "@xyflow/react"
import { Play, Loader2, Square } from "lucide-react"
import { WorkflowCanvas } from "./workflow-canvas"
import { NodeToolbar } from "./node-toolbar"
import { ConfigPanel } from "./config-panel"
import { EditorToolbar } from "./editor-toolbar"
import { UnsavedChangesDialog } from "./unsaved-changes-dialog"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { useWorkflowPersistence } from "@/hooks/use-workflow-persistence"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useProjectsStore } from "@/hooks/use-projects-store"
import { generateImage, generateVideo, videoToVideo, textToVideo, textToSpeech, generateScriptApi, combineVideos, mergeVideoAudioApi, extractAudioApi, trimVideoApi, resizeVideoApi, adjustVolumeApi, addCaptionsApi, mixAudioApi, generateMusicApi, textToAudioApi, getJobStatus } from "@/lib/api"
import type { WorkflowNode, WorkflowEdge, TextPromptData, UploadImageData, UploadVideoData, GenerateImageData, GenerateScriptData, ImageToVideoData, VideoToVideoData, TextToVideoData, TextToSpeechData, GenerateMusicData, TextToAudioData, CombineVideosData, MergeVideoAudioData, ExtractAudioData, TrimVideoData, ResizeVideoData, AdjustVolumeData, AddCaptionsData, MixAudioData, GeneratedResult, GeneratedScript, GeneratedScriptResult, SceneImageVersion, SceneNodeDataType } from "@/types/nodes"
import { buildScenePrompt } from "@/lib/prompt-builder"

interface WorkflowEditorProps {
  readonly projectId?: string
  readonly workflowId?: string
}

export function WorkflowEditor({ projectId, workflowId }: WorkflowEditorProps) {
  const { save, load, saving, loading } = useWorkflowPersistence(projectId)
  const fetchProjects = useProjectsStore((s) => s.fetchProjects)
  const router = useRouter()
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const pendingNavRef = useRef<string | null>(null)
  const pollIntervalsRef = useRef<Set<ReturnType<typeof setInterval>>>(new Set())

  useEffect(() => {
    if (workflowId) {
      load(workflowId)
    }
  }, [workflowId, load])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  const handleSave = useCallback(async () => {
    if (projectId) {
      await save(projectId)
    }
  }, [projectId, save])

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

  const EXECUTABLE_TYPES = new Set(["generate-script", "generate-image", "image-to-video", "video-to-video", "text-to-video", "text-to-speech", "generate-music", "text-to-audio", "combine-videos", "merge-video-audio", "extract-audio", "trim-video", "resize-video", "adjust-volume", "add-captions", "mix-audio", "scene"])

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
    if (type === "generate-image") {
      const results = (data.generatedResults as GeneratedResult[] | undefined) ?? []
      const activeIndex = (data.activeResultIndex as number | undefined) ?? 0
      return results[activeIndex]?.url ?? (data.generatedImageUrl as string | undefined)
    }
    if (type === "combine-videos") {
      const results = (data.generatedResults as GeneratedResult[] | undefined) ?? []
      const activeIndex = (data.activeResultIndex as number | undefined) ?? 0
      return results[activeIndex]?.url ?? (data.generatedVideoUrl as string | undefined)
    }
    if (type === "image-to-video" || type === "video-to-video" || type === "text-to-video") {
      const results = (data.generatedResults as GeneratedResult[] | undefined) ?? []
      const activeIndex = (data.activeResultIndex as number | undefined) ?? 0
      return results[activeIndex]?.url ?? (data.generatedVideoUrl as string | undefined)
    }
    if (type === "text-to-speech" || type === "generate-music" || type === "text-to-audio") {
      const results = (data.generatedResults as GeneratedResult[] | undefined) ?? []
      const activeIndex = (data.activeResultIndex as number | undefined) ?? 0
      return results[activeIndex]?.url ?? (data.generatedAudioUrl as string | undefined)
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
    if (type === "extract-audio" || type === "adjust-volume" || type === "mix-audio") {
      const results = (data.generatedResults as GeneratedResult[] | undefined) ?? []
      const activeIndex = (data.activeResultIndex as number | undefined) ?? 0
      return results[activeIndex]?.url ?? (data.generatedAudioUrl as string | undefined)
    }
    if (type === "reference-audio") {
      return (data.extractedAudioUrl as string | undefined)?.trim()
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

    const inputs: { prompt?: string; imageUrl?: string; videoUrl?: string; videoUrls?: string[]; audioUrl?: string; audioUrls?: string[]; referenceImageUrls?: string[] } = {}

    for (const src of sourceNodes) {
      const output = extractNodeOutput(src)
      if (!output) continue

      if (src.type === "text-prompt") {
        inputs.prompt = output
      } else if (src.type === "upload-image") {
        inputs.imageUrl = output
      } else if (src.type === "upload-video") {
        if (node.type === "combine-videos") {
          inputs.videoUrls = [...(inputs.videoUrls ?? []), output]
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
      } else if (src.type === "image-to-video" || src.type === "video-to-video" || src.type === "text-to-video" || src.type === "combine-videos" || src.type === "merge-video-audio" || src.type === "add-captions" || src.type === "resize-video" || src.type === "trim-video") {
        if (node.type === "combine-videos") {
          inputs.videoUrls = [...(inputs.videoUrls ?? []), output]
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
          ...(sceneData.locationAssetId ? [sceneData.locationAssetId] : []),
          ...sceneData.objects.map((o) => o.assetId),
        ]
        for (const assetId of allAssetIds) {
          const asset = characterDefinitions.find((a) => a.id === assetId)
          if (asset?.referenceImageUrl) {
            inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), asset.referenceImageUrl]
          }
        }
      } else if (src.type === "text-to-speech" || src.type === "generate-music" || src.type === "text-to-audio" || src.type === "extract-audio" || src.type === "adjust-volume" || src.type === "mix-audio") {
        if (node.type === "mix-audio") {
          inputs.audioUrls = [...(inputs.audioUrls ?? []), output]
        } else {
          inputs.audioUrl = output
        }
      }
    }

    return inputs
  }

  // --- Promise-based node execution ---

  function runImageGeneration(nodeId: string, prompt: string, referenceImageUrls?: string[], provider?: string): Promise<void> {
    const { updateNodeData } = useWorkflowStore.getState()
    updateNodeData(nodeId, { executionStatus: "running", generatedImageUrl: undefined })

    return new Promise((resolve, reject) => {
      generateImage(prompt, referenceImageUrls, provider).then(({ jobId }) => {
        toast.info("Image generation started", { description: `Job ID: ${jobId}` })

        const poll = trackInterval(setInterval(async () => {
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
              updateNodeData(nodeId, { executionStatus: "failed" })
              toast.error("Image generation failed", { description: job.error_message ?? "Unknown error" })
              reject(new Error(job.error_message ?? "Image generation failed"))
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
        toast.error("Failed to start image generation", {
          description: err instanceof Error ? err.message : "Unknown error",
        })
        reject(err)
      })
    })
  }

  function runVideoGeneration(nodeId: string, imageUrl: string, provider?: string, generateAudio?: boolean): Promise<void> {
    const { updateNodeData } = useWorkflowStore.getState()
    updateNodeData(nodeId, { executionStatus: "running", generatedVideoUrl: undefined })

    return new Promise((resolve, reject) => {
      generateVideo(imageUrl, undefined, provider, generateAudio).then(({ jobId }) => {
        toast.info("Video generation started", { description: `Job ID: ${jobId}` })

        const poll = trackInterval(setInterval(async () => {
          try {
            const job = await getJobStatus(jobId)
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
              })
              toast.success("Video generated")
              resolve()
            } else if (job.status === "failed") {
              untrackInterval(poll)
              updateNodeData(nodeId, { executionStatus: "failed" })
              toast.error("Video generation failed", { description: job.error_message ?? "Unknown error" })
              reject(new Error(job.error_message ?? "Video generation failed"))
            }
          } catch (err) {
            untrackInterval(poll)
            updateNodeData(nodeId, { executionStatus: "failed" })
            toast.error("Failed to check video job status")
            reject(err)
          }
        }, 2000))
      }).catch((err) => {
        updateNodeData(nodeId, { executionStatus: "failed" })
        toast.error("Failed to start video generation", {
          description: err instanceof Error ? err.message : "Unknown error",
        })
        reject(err)
      })
    })
  }

  function runVideoToVideoGeneration(nodeId: string, sourceVideoUrl: string, prompt?: string, provider?: string): Promise<void> {
    const { updateNodeData } = useWorkflowStore.getState()
    updateNodeData(nodeId, { executionStatus: "running", generatedVideoUrl: undefined })

    return new Promise((resolve, reject) => {
      videoToVideo(sourceVideoUrl, prompt, provider).then(({ jobId }) => {
        toast.info("Video-to-video generation started", { description: `Job ID: ${jobId}` })

        const poll = trackInterval(setInterval(async () => {
          try {
            const job = await getJobStatus(jobId)
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
              })
              toast.success("Video-to-video generated")
              resolve()
            } else if (job.status === "failed") {
              untrackInterval(poll)
              updateNodeData(nodeId, { executionStatus: "failed" })
              toast.error("Video-to-video generation failed", { description: job.error_message ?? "Unknown error" })
              reject(new Error(job.error_message ?? "Video-to-video generation failed"))
            }
          } catch (err) {
            untrackInterval(poll)
            updateNodeData(nodeId, { executionStatus: "failed" })
            toast.error("Failed to check video-to-video job status")
            reject(err)
          }
        }, 2000))
      }).catch((err) => {
        updateNodeData(nodeId, { executionStatus: "failed" })
        toast.error("Failed to start video-to-video generation", {
          description: err instanceof Error ? err.message : "Unknown error",
        })
        reject(err)
      })
    })
  }

  function runTextToVideoGeneration(nodeId: string, prompt: string, provider?: string): Promise<void> {
    const { updateNodeData } = useWorkflowStore.getState()
    updateNodeData(nodeId, { executionStatus: "running", generatedVideoUrl: undefined })

    return new Promise((resolve, reject) => {
      textToVideo(prompt, provider).then(({ jobId }) => {
        toast.info("Text-to-video generation started", { description: `Job ID: ${jobId}` })

        const poll = trackInterval(setInterval(async () => {
          try {
            const job = await getJobStatus(jobId)
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
              })
              toast.success("Text-to-video generated")
              resolve()
            } else if (job.status === "failed") {
              untrackInterval(poll)
              updateNodeData(nodeId, { executionStatus: "failed" })
              toast.error("Text-to-video generation failed", { description: job.error_message ?? "Unknown error" })
              reject(new Error(job.error_message ?? "Text-to-video generation failed"))
            }
          } catch (err) {
            untrackInterval(poll)
            updateNodeData(nodeId, { executionStatus: "failed" })
            toast.error("Failed to check text-to-video job status")
            reject(err)
          }
        }, 2000))
      }).catch((err) => {
        updateNodeData(nodeId, { executionStatus: "failed" })
        toast.error("Failed to start text-to-video generation", {
          description: err instanceof Error ? err.message : "Unknown error",
        })
        reject(err)
      })
    })
  }

  function runTextToSpeechGeneration(nodeId: string, text: string, voice?: string, provider?: string): Promise<void> {
    const { updateNodeData } = useWorkflowStore.getState()
    updateNodeData(nodeId, { executionStatus: "running" })

    return new Promise((resolve, reject) => {
      textToSpeech(text, voice, provider).then(({ jobId }) => {
        toast.info("Text-to-speech generation started", { description: `Job ID: ${jobId}` })

        const poll = trackInterval(setInterval(async () => {
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
              updateNodeData(nodeId, { executionStatus: "failed" })
              toast.error("Text-to-speech generation failed", { description: job.error_message ?? "Unknown error" })
              reject(new Error(job.error_message ?? "Text-to-speech generation failed"))
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
      generateScriptApi(prompt, sceneCount, tone, targetDuration, provider).then(({ jobId }) => {
        toast.info("Script generation started", { description: `Job ID: ${jobId}` })

        const poll = trackInterval(setInterval(async () => {
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
              updateNodeData(nodeId, { executionStatus: "failed" })
              toast.error("Script generation failed", { description: job.error_message ?? "Unknown error" })
              reject(new Error(job.error_message ?? "Script generation failed"))
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
      combineVideos(videoUrls, transition, transitionDuration).then(({ jobId }) => {
        toast.info("Combine videos started", { description: `Job ID: ${jobId}` })

        const poll = trackInterval(setInterval(async () => {
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
              updateNodeData(nodeId, { executionStatus: "failed" })
              toast.error("Combine videos failed", { description: job.error_message ?? "Unknown error" })
              reject(new Error(job.error_message ?? "Combine videos failed"))
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

  function runProcessingNode(nodeId: string, apiCall: () => Promise<{ jobId: string }>, outputKey: "generatedVideoUrl" | "generatedAudioUrl", label: string): Promise<void> {
    const { updateNodeData } = useWorkflowStore.getState()
    updateNodeData(nodeId, { executionStatus: "running", [outputKey]: undefined })

    return new Promise((resolve, reject) => {
      apiCall().then(({ jobId }) => {
        toast.info(`${label} started`, { description: `Job ID: ${jobId}` })

        const poll = trackInterval(setInterval(async () => {
          try {
            const job = await getJobStatus(jobId)
            if (job.status === "completed") {
              untrackInterval(poll)
              const url = outputKey === "generatedVideoUrl" ? job.output_data?.videoUrl : job.output_data?.audioUrl
              const existingResults = ((useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)?.data) as Record<string, unknown>)?.generatedResults as readonly GeneratedResult[] | undefined ?? []
              const newResult: GeneratedResult = { url: (url as string) ?? "", timestamp: new Date().toISOString(), jobId }
              updateNodeData(nodeId, {
                executionStatus: "completed",
                [outputKey]: url,
                generatedResults: [newResult, ...existingResults],
                activeResultIndex: 0,
              })
              toast.success(`${label} complete`)
              resolve()
            } else if (job.status === "failed") {
              untrackInterval(poll)
              updateNodeData(nodeId, { executionStatus: "failed" })
              toast.error(`${label} failed`, { description: job.error_message ?? "Unknown error" })
              reject(new Error(job.error_message ?? `${label} failed`))
            }
          } catch (err) {
            untrackInterval(poll)
            updateNodeData(nodeId, { executionStatus: "failed" })
            toast.error(`Failed to check ${label} status`)
            reject(err)
          }
        }, 2000))
      }).catch((err) => {
        updateNodeData(nodeId, { executionStatus: "failed" })
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
      const charDescs = charDefs.filter((c) => c.type === "description" && c.description).map((c) => {
        const label = c.category === "location" ? "location" : c.category === "object" ? "object" : "character"
        return `Include ${label} '${c.name}': ${c.description}.`
      })

      const refImages = [...(chainRefs ?? []), ...(extractedRefs ?? []), ...charRefUrls]
      const finalPrompt = charDescs.length > 0 ? `${prompt}\n${charDescs.join(" ")}` : prompt
      return runImageGeneration(node.id, finalPrompt, refImages.length > 0 ? refImages : undefined, (node.data as GenerateImageData).provider || undefined)
    }

    if (node.type === "image-to-video") {
      const imageUrl = inputs.imageUrl
      if (!imageUrl) {
        toast.error(`Node "${(node.data as ImageToVideoData).label}": no image found`)
        return Promise.reject(new Error("No image"))
      }
      return runVideoGeneration(node.id, imageUrl, (node.data as ImageToVideoData).provider || undefined, (node.data as ImageToVideoData).generateAudio)
    }

    if (node.type === "video-to-video") {
      const sourceVideoUrl = inputs.videoUrl
      if (!sourceVideoUrl) {
        toast.error(`Node "${(node.data as VideoToVideoData).label}": no source video found`)
        return Promise.reject(new Error("No source video"))
      }
      const v2vData = node.data as VideoToVideoData
      const prompt = v2vData.prompt?.trim()
      return runVideoToVideoGeneration(node.id, sourceVideoUrl, prompt, v2vData.provider || undefined)
    }

    if (node.type === "text-to-video") {
      const prompt = inputs.prompt ?? (node.data as TextToVideoData).prompt?.trim()
      if (!prompt) {
        toast.error(`Node "${(node.data as TextToVideoData).label}": no prompt found`)
        return Promise.reject(new Error("No prompt"))
      }
      return runTextToVideoGeneration(node.id, prompt, (node.data as TextToVideoData).provider || undefined)
    }

    if (node.type === "text-to-speech") {
      const text = inputs.prompt ?? ""
      if (!text) {
        toast.error(`Node "${(node.data as TextToSpeechData).label}": no text found`)
        return Promise.reject(new Error("No text"))
      }
      const ttsData = node.data as TextToSpeechData
      const voice = ttsData.voiceId
      return runTextToSpeechGeneration(node.id, text, voice || undefined, ttsData.provider || undefined)
    }

    if (node.type === "generate-music") {
      const prompt = inputs.prompt ?? (node.data as GenerateMusicData).prompt?.trim()
      if (!prompt) {
        toast.error(`Node "${(node.data as GenerateMusicData).label}": no prompt found`)
        return Promise.reject(new Error("No prompt"))
      }
      const d = node.data as GenerateMusicData
      const refUrl = inputs.audioUrl || d.referenceAudioUrl || undefined
      return runProcessingNode(node.id, () => generateMusicApi(prompt, d.provider || undefined, d.duration || undefined, d.genre || undefined, d.mood || undefined, d.instrumental, d.lyrics || undefined, refUrl), "generatedAudioUrl", "Generate Music")
    }

    if (node.type === "text-to-audio") {
      const prompt = inputs.prompt ?? (node.data as TextToAudioData).prompt?.trim()
      if (!prompt) {
        toast.error(`Node "${(node.data as TextToAudioData).label}": no prompt found`)
        return Promise.reject(new Error("No prompt"))
      }
      const d = node.data as TextToAudioData
      return runProcessingNode(node.id, () => textToAudioApi(prompt, d.provider || undefined, d.duration || undefined), "generatedAudioUrl", "Text to Audio")
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
      const audioUrl = inputs.audioUrl
      if (!videoUrl) { toast.error(`Node "${(node.data as MergeVideoAudioData).label}": no video input`); return Promise.reject(new Error("No video")) }
      if (!audioUrl) { toast.error(`Node "${(node.data as MergeVideoAudioData).label}": no audio input`); return Promise.reject(new Error("No audio")) }
      const d = node.data as MergeVideoAudioData
      return runProcessingNode(node.id, () => mergeVideoAudioApi(videoUrl, audioUrl, d.voiceoverVolume, d.backgroundVolume), "generatedVideoUrl", "Merge Video & Audio")
    }

    if (node.type === "extract-audio") {
      const videoUrl = inputs.videoUrl
      if (!videoUrl) { toast.error(`Node "${(node.data as ExtractAudioData).label}": no video input`); return Promise.reject(new Error("No video")) }
      const d = node.data as ExtractAudioData
      return runProcessingNode(node.id, () => extractAudioApi(videoUrl, d.audioFormat, d.outputSilentVideo), "generatedAudioUrl", "Extract Audio")
    }

    if (node.type === "trim-video") {
      const videoUrl = inputs.videoUrl
      if (!videoUrl) { toast.error(`Node "${(node.data as TrimVideoData).label}": no video input`); return Promise.reject(new Error("No video")) }
      const d = node.data as TrimVideoData
      return runProcessingNode(node.id, () => trimVideoApi(videoUrl, d.startTime, d.endTime || undefined), "generatedVideoUrl", "Trim Video")
    }

    if (node.type === "resize-video") {
      const videoUrl = inputs.videoUrl
      if (!videoUrl) { toast.error(`Node "${(node.data as ResizeVideoData).label}": no video input`); return Promise.reject(new Error("No video")) }
      const d = node.data as ResizeVideoData
      return runProcessingNode(node.id, () => resizeVideoApi(videoUrl, d.targetAspect, d.method, d.padColor || undefined), "generatedVideoUrl", "Resize Video")
    }

    if (node.type === "adjust-volume") {
      const audioUrl = inputs.audioUrl
      if (!audioUrl) { toast.error(`Node "${(node.data as AdjustVolumeData).label}": no audio input`); return Promise.reject(new Error("No audio")) }
      const d = node.data as AdjustVolumeData
      return runProcessingNode(node.id, () => adjustVolumeApi(audioUrl, d.volume, d.normalize, d.fadeIn, d.fadeOut), "generatedAudioUrl", "Adjust Volume")
    }

    if (node.type === "add-captions") {
      const videoUrl = inputs.videoUrl
      if (!videoUrl) { toast.error(`Node "${(node.data as AddCaptionsData).label}": no video input`); return Promise.reject(new Error("No video")) }
      const d = node.data as AddCaptionsData
      const text = inputs.prompt ?? ""
      if (!text) { toast.error(`Node "${d.label}": no caption text`); return Promise.reject(new Error("No text")) }
      return runProcessingNode(node.id, () => addCaptionsApi(videoUrl, text, d.style, d.position, d.fontSize, d.color), "generatedVideoUrl", "Add Captions")
    }

    if (node.type === "mix-audio") {
      const audioUrls = inputs.audioUrls ?? []
      if (audioUrls.length < 2) { toast.error(`Node "${(node.data as MixAudioData).label}": need at least 2 audio inputs`); return Promise.reject(new Error("Need at least 2 audio tracks")) }
      return runProcessingNode(node.id, () => mixAudioApi(audioUrls), "generatedAudioUrl", "Mix Audio")
    }

    if (node.type === "scene") {
      const sceneData = node.data as unknown as SceneNodeDataType
      const { characterDefinitions } = useWorkflowStore.getState()
      const prompt = buildScenePrompt(sceneData, characterDefinitions)
      if (!prompt.trim()) {
        toast.error(`Scene "${sceneData.sceneName || sceneData.label}": no scene data to generate prompt`)
        return Promise.reject(new Error("Empty scene prompt"))
      }

      // Collect reference images from all attached assets
      const allAssetIds = [
        ...sceneData.characters.map((c) => c.assetId),
        ...(sceneData.locationAssetId ? [sceneData.locationAssetId] : []),
        ...sceneData.objects.map((o) => o.assetId),
      ]
      const refUrls: string[] = []
      const charDescs: string[] = []
      for (const assetId of allAssetIds) {
        const asset = characterDefinitions.find((a) => a.id === assetId)
        if (asset?.referenceImageUrl) refUrls.push(asset.referenceImageUrl)
        if (asset?.type === "description" && asset.description) {
          const label = asset.category === "location" ? "location" : asset.category === "object" ? "object" : "character"
          charDescs.push(`Include ${label} '${asset.name}': ${asset.description}.`)
        }
      }
      const finalPrompt = charDescs.length > 0 ? `${prompt}\n${charDescs.join(" ")}` : prompt
      return runImageGeneration(node.id, finalPrompt, refUrls.length > 0 ? refUrls : undefined)
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

      if (results.some((r) => r.status === "rejected")) {
        failed = true
      }
    }

    if (pollIntervalsRef.current.size === 0) {
      setIsRunning(false)
    }

    if (failed) {
      toast.error("Workflow execution stopped due to errors")
    } else {
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
    const sceneCharNames0 = scene.characters ?? []
    for (const charName of sceneCharNames0) {
      const charDef = allCharDefs0.find((c) => c.name === charName)
      if (charDef && charDef.type === "description" && !charDef.referenceImageUrl) {
        // Find earliest scene using this character
        const earliestScene = script.scenes.findIndex((s, idx) =>
          idx !== sceneIndex && (s.characters ?? []).includes(charName)
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
    const sceneChars = new Set(scene.characters ?? [])
    const refUrls = extractedRefs
      .filter((r) => r.sourceSceneIndex !== sceneIndex && sceneChars.has(r.name))
      .map((r) => r.imageUrl)

    // Collect workflow-level character definitions matching scene characters
    const allCharDefs = useWorkflowStore.getState().characterDefinitions
    const sceneCharDefs = allCharDefs.filter((c) => sceneChars.has(c.name))
    const charRefUrls = sceneCharDefs
      .filter((c) => c.type === "reference" && c.referenceImageUrl)
      .map((c) => c.referenceImageUrl as string)
    const charDescs = sceneCharDefs
      .filter((c) => c.type === "description" && c.description)
      .map((c) => `Include character '${c.name}': ${c.description}.`)

    const allRefImages = [...refUrls, ...charRefUrls]
    const finalPrompt = charDescs.length > 0
      ? `${scene.imagePrompt}\n${charDescs.join(" ")}`
      : scene.imagePrompt

    updateSceneInScript(scriptNodeId, sceneIndex, { imageStatus: "running" })

    try {
      const { jobId } = await generateImage(finalPrompt, allRefImages.length > 0 ? allRefImages : undefined)

      await new Promise<void>((resolve, reject) => {
        const poll = trackInterval(setInterval(async () => {
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
      // Mark scene as failed if still running
      const latestNode = useWorkflowStore.getState().nodes.find((n) => n.id === scriptNodeId)
      const latestScene = (latestNode?.data as GenerateScriptData | undefined)?.generatedScript?.scenes[sceneIndex]
      if (latestScene?.imageStatus === "running") {
        updateSceneInScript(scriptNodeId, sceneIndex, { imageStatus: "failed" })
      }
      throw err
    }
  }

  function handleExpandStoryboard(
    scriptNodeId: string,
    options: { layout: "horizontal" | "vertical"; autoRun: boolean; includeCombine: boolean; narrationSource?: "visualDescription" | "action" | "imagePrompt" },
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
          provider: "elevenlabs",
          voiceId: "Rachel",
          language: "en",
          speed: 1,
          pitch: 1,
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

      // Edges: Generate Image → Image to Video
      newEdges.push({
        id: `edge_${Date.now()}_${i}_img_vid`,
        source: imageNodeId,
        sourceHandle: "image",
        target: videoNodeId,
        targetHandle: "in",
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
      for (const char of scenes[i].characters ?? []) {
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
        const sceneChars = new Set(scenes[i].characters ?? [])
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
      />
      <div className="flex-1 relative">
        <ReactFlowProvider>
          <WorkflowCanvas />
          <NodeToolbar />
          <ConfigPanel />
        </ReactFlowProvider>
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2">
          {isRunning ? (
            <>
              <Button
                size="lg"
                onClick={handleStop}
                className="rounded-full px-6 bg-orange-500 hover:bg-orange-600 text-white"
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
              className="rounded-full px-6 bg-orange-500 hover:bg-orange-600 text-white"
            >
              <Play className="w-4 h-4 mr-2" />
              Execute workflow
            </Button>
          )}
        </div>
      </div>
      <UnsavedChangesDialog
        open={showUnsavedDialog}
        onSave={handleDialogSave}
        onDiscard={handleDialogDiscard}
        onCancel={handleDialogCancel}
      />
    </div>
  )
}
