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
import { generateImage, generateVideo, getJobStatus } from "@/lib/api"
import type { TextPromptData, UploadImageData, GenerateImageData, ImageToVideoData, GeneratedResult } from "@/types/nodes"

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

  async function startImageGeneration(imageNodeId: string, prompt: string, chainToVideoNodeId?: string) {
    const { updateNodeData } = useWorkflowStore.getState()
    updateNodeData(imageNodeId, { executionStatus: "running", generatedImageUrl: undefined })

    try {
      const { jobId } = await generateImage(prompt)
      toast.info("Image generation started", { description: `Job ID: ${jobId}` })

      const poll = trackInterval(setInterval(async () => {
        try {
          const job = await getJobStatus(jobId)
          if (job.status === "completed") {
            untrackInterval(poll)
            const imageUrl = job.output_data?.imageUrl
            const existingResults = ((useWorkflowStore.getState().nodes.find((n) => n.id === imageNodeId)?.data) as GenerateImageData | undefined)?.generatedResults ?? []
            const newResult: GeneratedResult = { url: imageUrl ?? "", timestamp: new Date().toISOString(), jobId }
            updateNodeData(imageNodeId, {
              executionStatus: "completed",
              generatedImageUrl: imageUrl,
              generatedResults: [newResult, ...existingResults],
              activeResultIndex: 0,
            })
            toast.success("Image generated", {
              description: imageUrl ? "Click to open" : "Done",
              action: imageUrl ? { label: "Open", onClick: () => window.open(imageUrl, "_blank") } : undefined,
              duration: 10000,
            })
            if (chainToVideoNodeId && imageUrl) {
              startVideoGeneration(chainToVideoNodeId, imageUrl)
            }
          } else if (job.status === "failed") {
            untrackInterval(poll)
            updateNodeData(imageNodeId, { executionStatus: "failed" })
            toast.error("Image generation failed", { description: job.error_message ?? "Unknown error" })
          }
        } catch {
          untrackInterval(poll)
          updateNodeData(imageNodeId, { executionStatus: "failed" })
          toast.error("Failed to check job status")
        }
      }, 2000))
    } catch (err) {
      setIsRunning(false)
      updateNodeData(imageNodeId, { executionStatus: "failed" })
      toast.error("Failed to start image generation", {
        description: err instanceof Error ? err.message : "Unknown error",
      })
    }
  }

  async function handleRun() {
    const { nodes, edges, updateNodeData } = useWorkflowStore.getState()
    const textNode = nodes.find((n) => n.type === "text-prompt")
    const uploadImageNode = nodes.find((n) => n.type === "upload-image")
    const imageNode = nodes.find((n) => n.type === "generate-image")
    const videoNode = nodes.find((n) => n.type === "image-to-video")

    // Case 1: Text Prompt -> Generate Image (optionally chained to Image to Video)
    if (textNode && imageNode) {
      const prompt = (textNode.data as TextPromptData | undefined)?.text?.trim()
      if (!prompt) {
        toast.error("No prompt found. Add text to the Text Prompt node.")
        return
      }

      setIsRunning(true)

      const hasVideoChain = videoNode && edges.some(
        (e) => e.source === imageNode.id && e.target === videoNode.id
      )

      if (hasVideoChain && videoNode) {
        updateNodeData(videoNode.id, { executionStatus: "idle", generatedVideoUrl: undefined })
      }

      await startImageGeneration(
        imageNode.id,
        prompt,
        hasVideoChain && videoNode ? videoNode.id : undefined,
      )
    }

    // Case 2: Upload Image -> Image to Video
    else if (uploadImageNode && videoNode) {
      const imageUrl = (uploadImageNode.data as UploadImageData | undefined)?.url?.trim()
      if (!imageUrl) {
        toast.error("No image found. Upload an image first.")
        return
      }
      setIsRunning(true)
      startVideoGeneration(videoNode.id, imageUrl)
    }

    else {
      toast.error("Unknown workflow type. Connect nodes properly.")
    }
  }

  function handleRunSingleNode(nodeId: string) {
    const { nodes, edges } = useWorkflowStore.getState()
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return

    if (node.type === "generate-image") {
      const incomingEdge = edges.find((e) => e.target === nodeId)
      const sourceNode = incomingEdge ? nodes.find((n) => n.id === incomingEdge.source) : undefined

      let prompt: string | undefined
      if (sourceNode?.type === "text-prompt") {
        prompt = (sourceNode.data as TextPromptData | undefined)?.text?.trim()
      }

      if (!prompt) {
        toast.error("No prompt found. Connect a Text Prompt node.")
        return
      }

      setIsRunning(true)
      startImageGeneration(nodeId, prompt)
    } else if (node.type === "image-to-video") {
      const incomingEdge = edges.find((e) => e.target === nodeId)
      const sourceNode = incomingEdge ? nodes.find((n) => n.id === incomingEdge.source) : undefined

      let imageUrl: string | undefined

      if (sourceNode?.type === "upload-image") {
        imageUrl = (sourceNode.data as UploadImageData | undefined)?.url?.trim()
      } else if (sourceNode?.type === "generate-image") {
        const imgData = sourceNode.data as GenerateImageData | undefined
        const results = imgData?.generatedResults ?? []
        const activeIndex = imgData?.activeResultIndex ?? 0
        imageUrl = results[activeIndex]?.url ?? imgData?.generatedImageUrl
      }

      if (!imageUrl) {
        toast.error("No image found. Generate or upload an image first.")
        return
      }

      setIsRunning(true)
      startVideoGeneration(nodeId, imageUrl)
    } else {
      toast.error("This node type cannot be run individually.")
    }
  }

  async function startVideoGeneration(videoNodeId: string, imageUrl: string) {
    const { updateNodeData } = useWorkflowStore.getState()
    updateNodeData(videoNodeId, { executionStatus: "running", generatedVideoUrl: undefined })

    try {
      const { jobId } = await generateVideo(imageUrl)
      toast.info("Video generation started", { description: `Job ID: ${jobId}` })

      const poll = trackInterval(setInterval(async () => {
        try {
          const job = await getJobStatus(jobId)
          if (job.status === "completed") {
            untrackInterval(poll)
            const videoUrl = job.output_data?.videoUrl
            const existingResults = ((useWorkflowStore.getState().nodes.find((n) => n.id === videoNodeId)?.data) as ImageToVideoData | undefined)?.generatedResults ?? []
            const newResult: GeneratedResult = { url: videoUrl ?? "", timestamp: new Date().toISOString(), jobId }
            updateNodeData(videoNodeId, {
              executionStatus: "completed",
              generatedVideoUrl: videoUrl,
              generatedResults: [newResult, ...existingResults],
              activeResultIndex: 0,
            })
            toast.success("Video generated", {
              description: videoUrl ? "Click to open" : "Done",
              action: videoUrl ? { label: "Open", onClick: () => window.open(videoUrl, "_blank") } : undefined,
              duration: 10000,
            })
          } else if (job.status === "failed") {
            untrackInterval(poll)
            updateNodeData(videoNodeId, { executionStatus: "failed" })
            toast.error("Video generation failed", { description: job.error_message ?? "Unknown error" })
          }
        } catch {
          untrackInterval(poll)
          updateNodeData(videoNodeId, { executionStatus: "failed" })
          toast.error("Failed to check video job status")
        }
      }, 2000))
    } catch (err) {
      setIsRunning(false)
      updateNodeData(videoNodeId, { executionStatus: "failed" })
      toast.error("Failed to start video generation", {
        description: err instanceof Error ? err.message : "Unknown error",
      })
    }
  }

  // Register single-node runner
  useEffect(() => {
    useWorkflowStore.getState().setRunSingleNode(handleRunSingleNode)
    return () => useWorkflowStore.getState().setRunSingleNode(null)
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
