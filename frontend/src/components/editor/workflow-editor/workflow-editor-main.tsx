import { useCallback, useEffect, useRef, useState, useMemo, Suspense } from "react";
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry";
import { RUN_BUTTON_CLASS } from "@/lib/run-button-style";
import { useNavigate } from "react-router-dom";
import { isExpandedClone, filterCloneNodes } from "@nodaro/shared";
import { ReactFlowProvider } from "@xyflow/react";
import {
  Play,
  Loader2,
  Square,
  DollarSign,
  Layers,
  History,
  Monitor,
  ChevronDown,
  Trash2,
  RotateCcw,
  ExternalLink,
  Copy,
} from "lucide-react";
import { WorkflowCanvas } from "../workflow-canvas";
import { NodeToolbar } from "../node-toolbar";
import { ConfigPanel } from "../config-panel";
import { PipelinePanel } from "../pipeline-panel/pipeline-panel";
import { EditorToolbar } from "../editor-toolbar";
import { EditorErrorBoundary } from "../editor-error-boundary";
import { UnsavedChangesDialog } from "../unsaved-changes-dialog";
import { NavigateWithGuardContext } from "@/hooks/use-navigate-with-guard";
import { ExecutionsTab } from "../executions-tab";
import { ExecutionStatusBar } from "../execution-status-bar";
import { CostTab } from "../cost-tab";
import { SubWorkflowBreadcrumb } from "../sub-workflow-breadcrumb";
import { useSubWorkflowStack } from "@/hooks/use-sub-workflow-stack";
import { jumpToBreadcrumb, jumpToBreadcrumbRoot } from "@/lib/sub-workflow-navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { shouldConfirmDiscard, suppressDiscardConfirm } from "@/lib/run-confirm-pref";
import { toast } from "sonner";
import { useWorkflowPersistence } from "@/hooks/use-workflow-persistence";
import { useWorkflowStore } from "@/hooks/use-workflow-store";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useUndoRedoSubscription } from "@/hooks/use-undo-redo";
import { useAltKeyTracker } from "@/hooks/use-alt-key";
import { useProjectsStore } from "@/hooks/use-projects-store";
import { useAuth } from "@/hooks/use-auth";
import { useNodeDefaults } from "@/hooks/use-node-defaults";
import { createClient } from "@/lib/supabase";
import { StorageExceededError, uploadFile, setCurrentWorkflowId, cancelJob, discardWorkflowExecution } from "@/lib/api";
import { probeMediaMetadata } from "@/lib/probe-media-metadata";
import { matchShortcut, SHORTCUTS } from "@/lib/shortcuts";
import { queryClient } from "@/lib/query-client";
import { hasCredits } from "@/lib/edition";
import { getCachedCredits, prefetchModelCredits } from "@/ee/hooks/use-model-credits";
import { getModelIdentifier } from "@/components/editor/config-panels/helpers";
import { useStats } from "@/hooks/queries/use-stats-queries";
import { InsufficientCreditsModal } from "@/ee/components/credits/InsufficientCreditsModal";
import { StorageExceededModal } from "@/ee/components/credits/StorageExceededModal";
import { PromptQuickEditModal } from "@/components/nodes/prompt-quick-edit-modal";
import {
  NODE_CREDIT_COSTS,
  estimateNodeCredits,
  isExecutableNode,
  getFanOutMultiplier,
  type ExecutionContext,
} from "./types";
import {
  handleRun,
  handleRunSingleNode,
  handleRunFromHere,
  handleRunSelected,
  restorePollingForRunningJobs,
  streamBackendExecution,
  teardownActiveWorkflowStream,
} from "./run-handlers";
import { handleGenerateSceneImage as generateSceneImage, handleExpandStoryboard as expandStoryboard, handleCreateSceneNode as createSceneNode } from "./scene-story-handlers";
import { handleGenerateCharacterAsset, handleGenerateObjectAsset, handleGenerateLocationAsset } from "./asset-executors";
import { handleCreateNodesFromWriter as createNodesFromWriter, handleRunAllWriterImageNodes as runAllWriterImageNodes } from "./ai-writer-handlers";
import { resolveManualEdit } from "./execute-node";
import { extractNodeOutput } from "./execution-graph";
import { orderNodesParentFirst } from "./group-coords";
import { getOutputType } from "@nodaro/shared";
import { FreeCutImportPicker } from "../freecut-import-picker";
import { studioWorkflowUrl } from "@/lib/studio";
import { RemixProjectDialog } from "@/components/editor/remix-project-dialog";
import type { ManualEditData, GeneratedResult } from "@/types/nodes";
const FreeCutEditorModal = lazy(() => import("../freecut-editor-modal").then(m => ({ default: m.FreeCutEditorModal })));
const FilerobotEditorModal = lazy(() => import("../filerobot-editor-modal").then(m => ({ default: m.FilerobotEditorModal })));
const PresentationViewLazy = lazy(() => import("../../presentation/presentation-view").then(m => ({ default: m.PresentationView })));
const CharacterStudioModal = lazy(() => import("../character-studio"));
const LocationStudioModal = lazy(() => import("../location-studio/location-studio-modal"));
const ObjectStudioModal = lazy(() => import("../object-studio/object-studio-modal"));

interface WorkflowEditorProps {
  readonly projectId?: string;
  readonly workflowId?: string;
}

export function WorkflowEditor({ projectId, workflowId }: WorkflowEditorProps) {
  const { user } = useAuth();
  const { save, load, saving, loading } = useWorkflowPersistence(projectId);
  const fetchProjects = useProjectsStore((s) => s.fetchProjects);
  const createWorkflowWithContent = useProjectsStore((s) => s.createWorkflowWithContent);
  useUndoRedoSubscription();
  useAltKeyTracker();
  // Hydrate admin node defaults into React Query cache so addNode() can read them
  // synchronously. Cache key matches what use-workflow-store.addNode() reads.
  useNodeDefaults();
  const navigate = useNavigate();
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [remixOpen, setRemixOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [activeExecutionId, setActiveExecutionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"editor" | "present" | "executions" | "cost">(
    "editor",
  );
  const [sidebarVisible, setSidebarVisible] = useState(false);
  // Confirm dialog for the fallback single-node discard control. Holds the
  // action to run on confirm (or null when closed); mirrors run-node-button.tsx.
  const [singleDiscardConfirm, setSingleDiscardConfirm] = useState<(() => void) | null>(null);
  const [singleDiscardDontAsk, setSingleDiscardDontAsk] = useState(false);
  const isMobile = useIsMobile();
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const isReadOnly = useWorkflowStore((s) => s.isReadOnly);
  const selectedPipelineId = useWorkflowStore((s) => {
    if (!s.selectedNodeId) return undefined;
    const node = s.nodes.find((n) => n.id === s.selectedNodeId);
    if (!node || node.type !== "generative-pipeline") return undefined;
    const data = node.data as { pipeline_id?: string } | undefined;
    return data?.pipeline_id;
  });
  const configPanelFullscreen = useWorkflowStore((s) => s.configPanelFullscreen);
  const pendingNavRef = useRef<string | null>(null);
  const pollIntervalsRef = useRef<Set<ReturnType<typeof setInterval>>>(
    new Set(),
  );
  const ownerWorkflowIdRef = useRef<string | null>(workflowId ?? null);
  const [showInsufficientCredits, setShowInsufficientCredits] = useState(false);
  const [insufficientCreditsData, setInsufficientCreditsData] = useState<{
    required: number;
    available: number;
    tier: string;
  } | null>(null);
  const [workflowCreditEstimate, setWorkflowCreditEstimate] =
    useState<number>(0);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [showStorageExceeded, setShowStorageExceeded] = useState(false);
  const [storageExceededData, setStorageExceededData] = useState<{
    usedBytes: number;
    quotaBytes: number;
    tier: string;
  } | null>(null);

  // ---------------------------------------------------------------------------
  // FreeCut modal (manual-edit node + universal edit from any video node)
  // ---------------------------------------------------------------------------

  const storeNodes = useWorkflowStore((s) => s.nodes);
  const storeEdges = useWorkflowStore((s) => s.edges);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const freecutEdit = useWorkflowStore((s) => s.freecutEdit);
  const closeFreeCut = useWorkflowStore((s) => s.closeFreeCut);

  const manualEditNode = useMemo(
    () => storeNodes.find((n) => n.type === "manual-edit" && (n.data as ManualEditData).isEditorOpen),
    [storeNodes],
  );

  const meData = manualEditNode?.data as ManualEditData | undefined;
  const freecutNodeId = manualEditNode ? manualEditNode.id : freecutEdit?.nodeId;
  const isFreeCutOpen = !!manualEditNode || !!freecutEdit;

  // Collect all media assets from every node in the workflow for the import picker
  const allWorkflowAssets = useMemo(() => {
    if (!isFreeCutOpen) return undefined;
    const assets: Array<{ nodeId: string; url: string; type: "video" | "image" | "audio"; label?: string; thumbnailUrl?: string }> = [];
    for (const node of storeNodes) {
      if (!node.type) continue;
      const outputType = getOutputType(node.type);
      if (outputType !== "video" && outputType !== "image" && outputType !== "audio") continue;
      const url = extractNodeOutput(node);
      if (!url) continue;
      const srcData = node.data as Record<string, unknown>;
      const label = (srcData.label as string) ?? node.type;
      let thumbnailUrl: string | undefined;
      if (outputType === "image") {
        thumbnailUrl = url;
      } else {
        const results = (srcData.generatedResults as Array<{ thumbnailUrl?: string }> | undefined) ?? [];
        const activeIdx = (srcData.activeResultIndex as number | undefined) ?? 0;
        thumbnailUrl = results[activeIdx]?.thumbnailUrl ?? (srcData.thumbnailUrl as string | undefined);
      }
      assets.push({ nodeId: node.id, url, type: outputType, label, thumbnailUrl });
    }
    return assets.length > 0 ? assets : undefined;
  }, [isFreeCutOpen, storeNodes]);

  // For manual-edit nodes: collect assets from directly connected upstream nodes
  const manualEditConnectedAssets = useMemo(() => {
    if (!manualEditNode) return undefined;
    const VIDEO_TYPES = new Set([
      "image-to-video", "text-to-video", "video-to-video", "upload-video",
      "speech-to-video", "lip-sync", "render-video", "combine-videos",
      "merge-video-audio", "resize-video", "trim-video", "speed-ramp",
      "loop-video", "fade-video", "extend-video", "motion-transfer",
      "video-upscale", "suno-music-video", "manual-edit",
    ]);
    const IMAGE_TYPES = new Set([
      "generate-image", "upload-image", "image-to-image", "edit-image",
      "scene", "character", "object", "location", "face", "extract-frame",
    ]);
    const AUDIO_TYPES = new Set([
      "text-to-speech", "generate-music", "text-to-audio", "upload-audio",
      "reference-audio", "trim-audio", "adjust-volume", "mix-audio",
      "audio-isolation", "suno-generate", "suno-cover",
    ]);
    const assets: Array<{ nodeId: string; url: string; type: "video" | "image" | "audio"; label?: string }> = [];
    const inEdges = storeEdges.filter((e) => e.target === manualEditNode.id);
    for (const edge of inEdges) {
      const src = storeNodes.find((n) => n.id === edge.source);
      if (!src?.type) continue;
      const url = extractNodeOutput(src);
      if (!url) continue;
      const srcData = src.data as Record<string, unknown>;
      const label = (srcData.label as string) ?? src.type;
      let type: "video" | "image" | "audio" | undefined;
      if (VIDEO_TYPES.has(src.type)) type = "video";
      else if (IMAGE_TYPES.has(src.type)) type = "image";
      else if (AUDIO_TYPES.has(src.type)) type = "audio";
      if (type) assets.push({ nodeId: src.id, url, type, label });
    }
    return assets.length > 0 ? assets : undefined;
  }, [manualEditNode, storeNodes, storeEdges]);

  const freecutPrimaryAsset = manualEditNode
    ? manualEditConnectedAssets?.find(a => a.type === "video")
    : undefined;
  const freecutVideoUrl = manualEditNode
    ? (freecutPrimaryAsset?.url ?? meData?.inputVideoUrl ?? "")
    : (freecutEdit?.videoUrl ?? "");
  const freecutAdditionalAssets = manualEditNode
    ? manualEditConnectedAssets?.filter((a) => a.nodeId !== freecutPrimaryAsset?.nodeId)
    : undefined;
  const freecutProjectUrl = manualEditNode
    ? (meData?.generatedResults?.[meData?.activeResultIndex ?? 0]?.freecutProjectUrl)
    : freecutEdit?.freecutProjectUrl;

  // ---------------------------------------------------------------------------
  // Filerobot image editor modal (universal edit from any image node)
  // ---------------------------------------------------------------------------

  const imageEdit = useWorkflowStore((s) => s.imageEdit);
  const closeImageEdit = useWorkflowStore((s) => s.closeImageEdit);

  // ---------------------------------------------------------------------------
  // Character Studio modal (full-screen entity editor opened from character node)
  // ---------------------------------------------------------------------------

  const characterStudioNodeId = useWorkflowStore((s) => s.characterStudioNodeId);
  const setCharacterStudioNodeId = useWorkflowStore((s) => s.setCharacterStudioNodeId);
  const locationStudioNodeId = useWorkflowStore((s) => s.locationStudioNodeId);
  const setLocationStudioNodeId = useWorkflowStore((s) => s.setLocationStudioNodeId);
  const objectStudioNodeId = useWorkflowStore((s) => s.objectStudioNodeId);
  const setObjectStudioNodeId = useWorkflowStore((s) => s.setObjectStudioNodeId);

  const imageEditUrl = imageEdit?.imageUrl ?? "";
  const imageEditDesignStateUrl = imageEdit?.designStateUrl;
  const imageEditNodeId = imageEdit?.nodeId;
  const isImageEditOpen = !!imageEdit;

  const handleFreeCutExport = useCallback(
    async (blob: Blob, projectJson?: unknown) => {
      const nodeId = freecutNodeId;
      if (!nodeId) return;
      const isManualEdit = !!manualEditNode;
      try {
        const file = new File([blob], "freecut-edit.mp4", { type: "video/mp4" });
        // Probe video metadata in parallel with upload — by the time the upload
        // resolves, dimensions/duration are ready to embed in the result so the
        // node sizes correctly on first render.
        const [result, mediaMeta] = await Promise.all([
          uploadFile(file, user?.id),
          probeMediaMetadata(blob),
        ]);
        const url = result.url;

        // Upload project JSON to R2 for future restore
        let projectUrl: string | undefined;
        if (projectJson) {
          try {
            const headers = await import("@/lib/api").then((m) => m.getAuthHeaders());
            const res = await fetch("/v1/upload-json", {
              method: "POST",
              headers: { ...headers, "Content-Type": "application/json" },
              body: JSON.stringify(projectJson),
            });
            if (res.ok) {
              const data = await res.json();
              projectUrl = data.url;
            }
          } catch {
            // Project save failed — video still saved successfully
          }
        }

        const newResult: GeneratedResult = {
          url,
          jobId: `freecut-edit-${Date.now()}`,
          timestamp: new Date().toISOString(),
          freecutProjectUrl: projectUrl,
          ...(mediaMeta?.width && mediaMeta?.height ? { width: mediaMeta.width, height: mediaMeta.height } : {}),
          ...(mediaMeta?.duration !== undefined ? { duration: mediaMeta.duration } : {}),
        };
        const freshNode = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId);
        const prev = freshNode ? ((freshNode.data as Record<string, unknown>).generatedResults as readonly GeneratedResult[] ?? []) : [];
        updateNodeData(nodeId, {
          executionStatus: "completed",
          generatedVideoUrl: url,
          generatedResults: [...prev, newResult],
          activeResultIndex: prev.length,
          ...(isManualEdit ? { isEditorOpen: false } : {}),
        });
        if (isManualEdit) resolveManualEdit(nodeId);
        if (!isManualEdit) closeFreeCut();
      } catch (err) {
        if (err instanceof StorageExceededError) {
          setShowStorageExceeded(true);
          setStorageExceededData({ usedBytes: err.usedBytes, quotaBytes: err.quotaBytes, tier: err.tier });
        }
        if (isManualEdit) {
          updateNodeData(nodeId, {
            executionStatus: "failed",
            errorMessage: err instanceof Error ? err.message : "Upload failed",
            isEditorOpen: false,
          });
        }
        if (!isManualEdit) closeFreeCut();
      }
    },
    [freecutNodeId, manualEditNode, user?.id, updateNodeData, closeFreeCut],
  );

  const handleFreeCutClose = useCallback(() => {
    if (manualEditNode) {
      updateNodeData(manualEditNode.id, { isEditorOpen: false });
    }
    if (freecutEdit) {
      closeFreeCut();
    }
  }, [manualEditNode, freecutEdit, updateNodeData, closeFreeCut]);

  // ---------------------------------------------------------------------------
  // FreeCut import picker (workflow assets + library + file system)
  // ---------------------------------------------------------------------------

  const [importPickerOpen, setImportPickerOpen] = useState(false);
  const [importPickerAccept, setImportPickerAccept] = useState("video/*,audio/*,image/*");
  const [importPickerMultiple, setImportPickerMultiple] = useState(true);
  const sendImportFilesRef = useRef<((files: Array<{ name: string; type: string; size: number; buffer: ArrayBuffer }>) => void) | null>(null);

  const handleImportRequest = useCallback((accept: string, multiple: boolean) => {
    setImportPickerAccept(accept);
    setImportPickerMultiple(multiple);
    setImportPickerOpen(true);
  }, []);

  const handleImportFiles = useCallback((files: Array<{ name: string; type: string; size: number; buffer: ArrayBuffer }>) => {
    sendImportFilesRef.current?.(files);
    setImportPickerOpen(false);
  }, []);

  const handleImageEditSave = useCallback(
    async (blob: Blob, designState: unknown) => {
      const nodeId = imageEditNodeId;
      if (!nodeId) return;
      try {
        const file = new File([blob], "edited-image.png", { type: "image/png" });

        // Upload image, designState, and probe dimensions all in parallel.
        const uploadImagePromise = uploadFile(file, user?.id);
        const uploadDesignStatePromise = designState
          ? import("@/lib/api")
              .then((m) => m.getAuthHeaders())
              .then((headers) =>
                fetch("/v1/upload-json", {
                  method: "POST",
                  headers: { ...headers, "Content-Type": "application/json" },
                  body: JSON.stringify(designState),
                }),
              )
              .then((res) => (res.ok ? res.json() : undefined))
              .then((data) => data?.url as string | undefined)
              .catch(() => undefined)
          : Promise.resolve(undefined);

        const [imageResult, designStateUrl, mediaMeta] = await Promise.all([
          uploadImagePromise,
          uploadDesignStatePromise,
          probeMediaMetadata(blob),
        ]);
        const url = imageResult.url;

        const newResult: GeneratedResult = {
          url,
          jobId: `image-edit-${Date.now()}`,
          timestamp: new Date().toISOString(),
          filerobotDesignStateUrl: designStateUrl,
          ...(mediaMeta?.width && mediaMeta?.height ? { width: mediaMeta.width, height: mediaMeta.height } : {}),
        };

        const freshNode = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId);
        const freshData = freshNode?.data as Record<string, unknown> | undefined;
        const prev = (freshData?.generatedResults as readonly GeneratedResult[] | undefined) ?? [];

        const nodeType = freshNode?.type ?? "";
        const isEntity = ["character", "face", "object", "location"].includes(nodeType);
        const legacyUrlField = isEntity ? "sourceImageUrl" : "generatedImageUrl";

        updateNodeData(nodeId, {
          executionStatus: "completed",
          [legacyUrlField]: url,
          generatedResults: [...prev, newResult],
          activeResultIndex: prev.length,
        });

        closeImageEdit();
      } catch (err) {
        if (err instanceof StorageExceededError) {
          setShowStorageExceeded(true);
          setStorageExceededData({ usedBytes: err.usedBytes, quotaBytes: err.quotaBytes, tier: err.tier });
        }
        closeImageEdit();
      }
    },
    [imageEditNodeId, user?.id, updateNodeData, closeImageEdit],
  );

  const handleImageEditClose = useCallback(() => {
    closeImageEdit();
  }, [closeImageEdit]);

  // ---------------------------------------------------------------------------
  // Credit estimate (accounts for fan-out from list/loop nodes)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!hasCredits()) return;
    const executableNodes = storeNodes.filter((n) => isExecutableNode(n) && !isExpandedClone(n));

    // Use composite model identifiers (e.g. "gpt-image:high") for accurate per-model lookup
    const computeEstimate = () => {
      const total = executableNodes.reduce((sum, node) => {
        const modelId = getModelIdentifier(node);
        const cached = getCachedCredits(modelId);
        const cost = cached !== undefined ? cached : estimateNodeCredits({ type: node.type, data: node.data as Record<string, unknown> });
        const multiplier = getFanOutMultiplier(node, storeNodes, storeEdges);
        return sum + cost * multiplier;
      }, 0);
      setWorkflowCreditEstimate(total);
    };

    // Collect model identifiers and check which need fetching
    const modelIds = [...new Set(executableNodes.map((n) => getModelIdentifier(n)).filter(Boolean))];
    const uncached = modelIds.filter((m) => getCachedCredits(m) === undefined);

    if (uncached.length > 0) {
      // Wait for real costs before showing estimate
      setEstimateLoading(true);
      let cancelled = false;
      prefetchModelCredits(uncached).then(() => {
        if (!cancelled) {
          computeEstimate();
          setEstimateLoading(false);
        }
      });
      return () => { cancelled = true; };
    }

    // All costs cached — compute immediately
    setEstimateLoading(false);
    computeEstimate();
  }, [storeNodes, storeEdges]);

  // Only poll /v1/stats while there is local activity worth watching: a
  // workflow/single-node run in progress, store nodes still running/pending,
  // or the last server snapshot still reporting active jobs (so we keep
  // polling until the backend confirms the count has drained to zero).
  // Otherwise the interval returns `false` and stops — no idle background
  // polling. The displayed value stays correct because the query still
  // refetches on the activity transitions that flip this gate.
  const hasLocalActivity =
    isRunning ||
    storeNodes.some((n) => {
      const s = (n.data as Record<string, unknown>).executionStatus;
      return s === "running" || s === "pending";
    });
  const { data: statsData } = useStats("user", user?.id, {
    refetchInterval: (query) => {
      const data = query.state.data;
      const serverActive = (data?.pending ?? 0) + (data?.processing ?? 0);
      return hasLocalActivity || serverActive > 0 ? 30_000 : false;
    },
  });
  const activeJobCount =
    (statsData?.pending ?? 0) + (statsData?.processing ?? 0);

  // ---------------------------------------------------------------------------
  // Workflow loading and lifecycle
  // ---------------------------------------------------------------------------

  // Set the active workflow ID so single-node runs tag their jobs with it
  useEffect(() => {
    setCurrentWorkflowId(workflowId ?? null);
    return () => setCurrentWorkflowId(null);
  }, [workflowId]);

  useEffect(() => {
    if (workflowId) {
      for (const interval of pollIntervalsRef.current) {
        clearInterval(interval);
      }
      pollIntervalsRef.current.clear();
      setIsRunning(false);

      ownerWorkflowIdRef.current = workflowId;
      load(workflowId).then((result) => {
        // Check if any loaded nodes are still in running/pending state
        // and show the "Executing workflow" button immediately.
        const { nodes: loadedNodes } = useWorkflowStore.getState();
        const hasRunningNodes = loadedNodes.some((n) => {
          const s = (n.data as Record<string, unknown>).executionStatus;
          return s === "running" || s === "pending";
        });
        if (hasRunningNodes) {
          setIsRunning(true);
        }

        if (result.stillRunningJobs && result.stillRunningJobs.length > 0) {
          restorePollingForRunningJobs(
            result.stillRunningJobs,
            ctx,
            setIsRunning,
          );
        }
        // Restore polling for active backend orchestrator execution
        if (result.activeBackendExecution) {
          streamBackendExecution(
            result.activeBackendExecution.executionId,
            ctx,
            setIsRunning,
          );
        }

        // If nodes appeared running but no polling was restored (e.g. no
        // jobId was persisted, or backend execution already finished),
        // reset those stale running nodes to idle so they don't stay stuck.
        if (
          hasRunningNodes &&
          (!result.stillRunningJobs || result.stillRunningJobs.length === 0) &&
          !result.activeBackendExecution
        ) {
          const { nodes: currentNodes, updateNodeData: update } =
            useWorkflowStore.getState();
          for (const n of currentNodes) {
            const s = (n.data as Record<string, unknown>).executionStatus;
            if (s === "running" || s === "pending") {
              update(n.id, { executionStatus: "idle" });
            }
          }
          setIsRunning(false);
        }
      });
    }
  }, [workflowId, load]);

  const cachedAccessTokenRef = useRef<string | null>(null);
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      cachedAccessTokenRef.current = data.session?.access_token ?? null;
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      cachedAccessTokenRef.current = session?.access_token ?? null;
    });
    return () => subscription.unsubscribe();
  }, []);

  // Flush save on page unload
  const executionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    function handleBeforeUnload() {
      if (!projectId) return;
      const state = useWorkflowStore.getState();
      // Read-only (Studio) workflows must never be persisted from the editor.
      // Auto-layout routes through the controlled onNodesChange and flips
      // isDirty even for read-only workflows, so the isDirty check below is
      // not enough on its own — bail before building/PATCHing the payload.
      if (state.isReadOnly) return;
      if (!state.isDirty || state.nodes.length === 0) return;

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as
        | string
        | undefined;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as
        | string
        | undefined;
      const wfId = state.workflowId;
      const token = cachedAccessTokenRef.current;
      if (!supabaseUrl || !supabaseKey || !wfId || !token) return;

      const payload = {
        nodes: structuredClone(orderNodesParentFirst(state.nodes)),
        edges: structuredClone(state.edges),
        settings: {
          // MUST mirror the normal save in use-workflow-persistence.ts (~L534):
          // PostgREST PATCH REPLACES the whole `settings` JSONB column, so any
          // subfield omitted here is DESTROYED on unload. Omitting
          // presentationSettings + viewport silently wiped all published-app I/O
          // curation (inputItems/outputItems/cardMeta/view modes/share settings)
          // and the saved viewport whenever a tab was closed mid-edit.
          characterDefinitions: structuredClone(state.characterDefinitions),
          flowPromptTemplates: structuredClone(state.flowPromptTemplates),
          presentationSettings: structuredClone(state.presentationSettings),
          viewport: state.savedViewport,
        },
      };

      // Optimistic locking on the unload-flush: PostgREST treats each
      // query-string `<col>=eq.<v>` filter as an AND'd predicate, so
      // adding `&updated_at=eq.<loadedUpdatedAt>` mirrors the in-app
      // `.eq("updated_at", ...)` chain. If another device wrote first
      // the row no longer matches, the PATCH is a silent 0-row no-op
      // (better than overwriting remote with stale fields the user
      // never got a chance to merge). When loadedUpdatedAt is null we
      // fall back to last-write-wins — a brand-new workflow that has
      // never been saved has no version to lock against.
      const lockedAt = state.loadedUpdatedAt;
      const url = lockedAt
        ? `${supabaseUrl}/rest/v1/workflows?id=eq.${wfId}&updated_at=eq.${encodeURIComponent(lockedAt)}`
        : `${supabaseUrl}/rest/v1/workflows?id=eq.${wfId}`;

      fetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseKey,
          Authorization: `Bearer ${token}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      ownerWorkflowIdRef.current = null;
      if (executionSaveTimerRef.current) {
        clearTimeout(executionSaveTimerRef.current);
        executionSaveTimerRef.current = null;
      }
      for (const interval of pollIntervalsRef.current) {
        clearInterval(interval);
      }
      pollIntervalsRef.current.clear();
    };
  }, [projectId]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    useWorkflowStore.getState().setProjectId(projectId ?? null);
  }, [projectId]);

  // ---------------------------------------------------------------------------
  // Save / auto-save
  // ---------------------------------------------------------------------------

  const handleSave = useCallback(async () => {
    if (projectId) {
      await save(projectId);
    }
  }, [projectId, save]);

  useEffect(() => {
    if (!projectId || loading) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let maxTimer: ReturnType<typeof setTimeout> | null = null;

    // Multi-tab safety: when a realtime broadcast tells us another
    // device wrote a newer version while local state was dirty, the
    // optimistic-lock cursor (`loadedUpdatedAt`) is now stale. Letting
    // the autosave keep firing here would just hit the .eq("updated_at")
    // mismatch every 3 seconds and spam toasts — pause the loop until
    // the user reloads (clears `remoteUpdatedAt`) or saves over (which
    // advances `loadedUpdatedAt` past the divergence).
    function remoteIsAhead() {
      const s = useWorkflowStore.getState();
      return s.remoteUpdatedAt != null && s.remoteUpdatedAt !== s.loadedUpdatedAt;
    }

    function doSave() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (maxTimer) {
        clearTimeout(maxTimer);
        maxTimer = null;
      }
      const current = useWorkflowStore.getState();
      if (
        current.isDirty &&
        current.saveStatus !== "saving" &&
        current.nodes.length > 0 &&
        !remoteIsAhead()
      ) {
        save(projectId);
      }
    }

    const unsub = useWorkflowStore.subscribe((state) => {
      const remoteAhead =
        state.remoteUpdatedAt != null &&
        state.remoteUpdatedAt !== state.loadedUpdatedAt;
      if (state.isDirty && state.saveStatus !== "saving" && !remoteAhead) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(doSave, 3000);

        if (!maxTimer) {
          maxTimer = setTimeout(doSave, 10_000);
        }
      } else if (!state.isDirty || remoteAhead) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (maxTimer) {
          clearTimeout(maxTimer);
          maxTimer = null;
        }
      }
    });

    return () => {
      unsub();
      if (timer) clearTimeout(timer);
      if (maxTimer) clearTimeout(maxTimer);
    };
  }, [projectId, loading, save]);

  // ---------------------------------------------------------------------------
  // Execution context + interval tracking
  // ---------------------------------------------------------------------------

  function isWorkflowStale(): boolean {
    const currentId = useWorkflowStore.getState().workflowId;
    return currentId !== ownerWorkflowIdRef.current;
  }

  function trackInterval(
    interval: ReturnType<typeof setInterval>,
  ): ReturnType<typeof setInterval> {
    const wasEmpty = pollIntervalsRef.current.size === 0;
    pollIntervalsRef.current.add(interval);

    if (wasEmpty && projectId && !executionSaveTimerRef.current) {
      executionSaveTimerRef.current = setTimeout(() => {
        executionSaveTimerRef.current = null;
        save(projectId);
      }, 500);
    }

    return interval;
  }

  function untrackInterval(interval: ReturnType<typeof setInterval>): void {
    clearInterval(interval);
    pollIntervalsRef.current.delete(interval);
    if (pollIntervalsRef.current.size === 0) {
      setIsRunning(false);
      if (projectId) {
        save(projectId);
      }
    }
  }

  function isStorageError(err: unknown): boolean {
    return err instanceof StorageExceededError;
  }

  const ctx: ExecutionContext = {
    userId: user?.id,
    projectId,
    trackInterval,
    untrackInterval,
    save: async (pid: string) => { await save(pid); },
    setIsRunning,
    isWorkflowStale,
    isStorageError,
    setShowStorageExceeded,
    setStorageExceededData,
    setShowInsufficientCredits,
    setInsufficientCreditsData,
  };

  // ---------------------------------------------------------------------------
  // Execution lifecycle
  // ---------------------------------------------------------------------------

  const onExecutionStarted = useCallback((id: string) => {
    setActiveExecutionId(id);
    queryClient.invalidateQueries({ queryKey: ["workflow-executions"] });
  }, []);

  const onExecutionEnded = useCallback(() => {
    setIsRunning(false);
    setActiveExecutionId(null);
    queryClient.invalidateQueries({ queryKey: ["workflow-executions"] });
  }, []);

  // Pure UI cleanup for a whole-workflow discard. CRITICAL: this NEVER calls a
  // workflow-level API cancel — the discard API call (discardWorkflowExecution,
  // mode:"discard") already happened in the status bar (or in handleRunInstead).
  // Calling cancelWorkflowExecution here would double-cancel and KILL the
  // in-flight jobs — the exact opposite of discard. This only detaches the
  // canvas: reverts in-flight/queued nodes to idle (clearing currentJobId so the
  // per-node poll guard bails) and clears local polling/run state.
  function handleExecutionDiscarded(): void {
    // FIRST: fully stop the OLD whole-workflow stream — abort its SSE connection
    // and set its `finished` flag — BEFORE we do any canvas cleanup or start a
    // subsequent run. Without this, the old stream stays live; when the OLD
    // execution reaches `discarded` server-side seconds later, its still-open SSE
    // would fire onDiscarded and revert the NEW run's running/pending nodes to
    // idle, wiping the freshly-started "Run instead" run. Tearing the stream down
    // here also means its onDiscarded never fires for a bar-initiated discard, so
    // only one "Run discarded…" toast shows (the bar's).
    teardownActiveWorkflowStream();
    for (const interval of pollIntervalsRef.current) clearInterval(interval);
    pollIntervalsRef.current.clear();
    setIsRunning(false);
    setActiveExecutionId(null);
    const { nodes, updateNodeData } = useWorkflowStore.getState();
    for (const node of nodes) {
      const d = node.data as Record<string, unknown>;
      if (d.executionStatus === "running" || d.executionStatus === "pending") {
        updateNodeData(node.id, { executionStatus: "idle", currentJobId: undefined, currentJobProgress: undefined });
      }
    }
    setTimeout(() => queryClient.invalidateQueries({ queryKey: ["workflow-executions"] }), 500);
  }

  // "Run instead" for the whole-workflow bar: discard the active run (in-flight
  // jobs finish → Library, off canvas), detach the canvas, then start a fresh
  // run. Order matters — discard old → UI cleanup → handleRun new.
  function handleRunInstead(): void {
    const id = activeExecutionId;
    if (id) discardWorkflowExecution(id).catch(() => {});
    handleExecutionDiscarded();
    handleRun(ctx, projectId, useWorkflowStore.getState().workflowId, save, setIsRunning, onExecutionStarted, onExecutionEnded);
  }

  // Discard for the fallback single-node control (no whole-workflow execution).
  // Uses the phase-aware per-job cancelJob: a job that hasn't been dispatched to
  // the provider yet is cancelled+refunded; one already in flight finishes and
  // lands in My Library (off the canvas). Clears currentJobId FIRST so the
  // per-node poll guard abandons it before any re-run writes a new key.
  function handleSingleNodeDiscard(): void {
    const { nodes, updateNodeData } = useWorkflowStore.getState();
    const jobIds: string[] = [];
    for (const node of nodes) {
      const d = node.data as Record<string, unknown>;
      if (d.executionStatus === "running" || d.executionStatus === "pending") {
        if (d.currentJobId) jobIds.push(d.currentJobId as string);
        updateNodeData(node.id, { executionStatus: "idle", currentJobId: undefined, currentJobProgress: undefined });
      }
    }
    for (const jobId of jobIds) cancelJob(jobId).catch(() => {});
    for (const interval of pollIntervalsRef.current) clearInterval(interval);
    pollIntervalsRef.current.clear();
    setIsRunning(false);
    setTimeout(() => queryClient.invalidateQueries({ queryKey: ["workflow-executions"] }), 500);
  }

  // Gate a single-node discard action behind the shared confirm dialog unless
  // the user opted out (same preference key as run-node-button.tsx).
  function withSingleDiscardConfirm(action: () => void): void {
    if (shouldConfirmDiscard()) {
      setSingleDiscardDontAsk(false);
      // Wrap in an arrow so React's functional setState doesn't *call* it.
      setSingleDiscardConfirm(() => action);
    } else {
      action();
    }
  }

  // ---------------------------------------------------------------------------
  // Register store callbacks
  // ---------------------------------------------------------------------------

  useEffect(() => {
    useWorkflowStore.getState().setRunSingleNode(
      isReadOnly ? null : (nodeId: string) => handleRunSingleNode(nodeId, ctx, projectId, save, setIsRunning, pollIntervalsRef)
        .finally(() => {
          // Invalidate execution history so the single-node run appears immediately
          if (workflowId) {
            queryClient.invalidateQueries({ queryKey: ["workflow-executions", workflowId] });
          }
        }),
    );
    return () => useWorkflowStore.getState().setRunSingleNode(null);
  });

  useEffect(() => {
    useWorkflowStore.getState().setRunFromHere(
      isReadOnly ? null : (nodeId: string) => handleRunFromHere(nodeId, ctx, projectId, save, setIsRunning, onExecutionStarted, onExecutionEnded),
    );
    return () => useWorkflowStore.getState().setRunFromHere(null);
  });

  useEffect(() => {
    useWorkflowStore.getState().setRunSelected(
      isReadOnly ? null : () => handleRunSelected(ctx, projectId, save, setIsRunning, onExecutionStarted, onExecutionEnded),
    );
    return () => useWorkflowStore.getState().setRunSelected(null);
  });

  useEffect(() => {
    useWorkflowStore.getState().setGenerateSceneImage(
      isReadOnly ? null : (scriptNodeId: string, sceneIndex: number) => generateSceneImage(scriptNodeId, sceneIndex, ctx),
    );
    return () => useWorkflowStore.getState().setGenerateSceneImage(null);
  });

  useEffect(() => {
    useWorkflowStore.getState().setExpandStoryboard(isReadOnly ? null : expandStoryboard);
    return () => useWorkflowStore.getState().setExpandStoryboard(null);
  });

  useEffect(() => {
    useWorkflowStore.getState().setCreateSceneNodeFromScript(isReadOnly ? null : createSceneNode);
    return () => useWorkflowStore.getState().setCreateSceneNodeFromScript(null);
  });

  useEffect(() => {
    useWorkflowStore.getState().setGenerateCharacterAssetFn(
      isReadOnly ? null : (nodeId: string, assetType: "expressions" | "poses" | "lighting" | "angles") => handleGenerateCharacterAsset(nodeId, assetType, ctx),
    );
    return () => useWorkflowStore.getState().setGenerateCharacterAssetFn(null);
  });

  useEffect(() => {
    useWorkflowStore.getState().setGenerateObjectAssetFn(
      isReadOnly ? null : (nodeId: string, assetType: "angles" | "materials" | "variations") => handleGenerateObjectAsset(nodeId, assetType, ctx),
    );
    return () => useWorkflowStore.getState().setGenerateObjectAssetFn(null);
  });

  useEffect(() => {
    useWorkflowStore.getState().setGenerateLocationAssetFn(
      isReadOnly ? null : (nodeId: string, assetType: "timeOfDay" | "weather" | "angles") => handleGenerateLocationAsset(nodeId, assetType, ctx),
    );
    return () => useWorkflowStore.getState().setGenerateLocationAssetFn(null);
  });

  useEffect(() => {
    useWorkflowStore.getState().setCreateNodesFromWriter(isReadOnly ? null : createNodesFromWriter);
    return () => useWorkflowStore.getState().setCreateNodesFromWriter(null);
  });

  useEffect(() => {
    useWorkflowStore.getState().setRunAllWriterImageNodes(
      isReadOnly ? null : (writerNodeId: string) => runAllWriterImageNodes(writerNodeId, ctx, pollIntervalsRef),
    );
    return () => useWorkflowStore.getState().setRunAllWriterImageNodes(null);
  });

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts and navigation guards
  // ---------------------------------------------------------------------------

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (matchShortcut(e, SHORTCUTS.save)) {
        e.preventDefault();
        handleSave();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave]);

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      const isDirty = useWorkflowStore.getState().isDirty;
      if (!isDirty) return;
      e.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  const navigateWithGuard = useCallback(
    (href: string) => {
      const isDirty = useWorkflowStore.getState().isDirty;
      if (!isDirty) {
        navigate(href);
        return;
      }
      pendingNavRef.current = href;
      setShowUnsavedDialog(true);
    },
    [navigate],
  );

  // Clone a read-only (Studio) workflow into an editable copy in the chosen
  // project. The `studio` marker is intentionally omitted from settings so the
  // copy is editable. Temporary clone/sub-workflow nodes are filtered out and
  // nodes are persisted parent-first (same invariant as the regular save path).
  const handleRemix = useCallback(async (targetProjectId: string) => {
    const st = useWorkflowStore.getState();
    const cleaned = filterCloneNodes(st.nodes, st.edges, { filterSubWorkflow: true });
    const nodes = orderNodesParentFirst(cleaned.nodes);
    const settings = {
      characterDefinitions: st.characterDefinitions,
      flowPromptTemplates: st.flowPromptTemplates,
      presentationSettings: st.presentationSettings,
      viewport: st.savedViewport,
      // NOTE: `studio` marker intentionally omitted → the copy is editable.
    };
    const wf = await createWorkflowWithContent(targetProjectId, {
      name: `${st.workflowName} (Remix)`.slice(0, 200),
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(cleaned.edges)),
      settings: JSON.parse(JSON.stringify(settings)),
    });
    if (wf) navigate(`/projects/${targetProjectId}/workflows/${wf.id}`);
  }, [createWorkflowWithContent, navigate]);

  function handleDialogSave(): void {
    setShowUnsavedDialog(false);
    handleSave().then(() => {
      if (pendingNavRef.current) {
        navigate(pendingNavRef.current);
        pendingNavRef.current = null;
      }
    });
  }

  function handleDialogDiscard(): void {
    setShowUnsavedDialog(false);
    useWorkflowStore.getState().markClean();
    if (pendingNavRef.current) {
      navigate(pendingNavRef.current);
      pendingNavRef.current = null;
    }
  }

  function handleDialogCancel(): void {
    setShowUnsavedDialog(false);
    pendingNavRef.current = null;
  }

  // ---------------------------------------------------------------------------
  // Sub-workflow breadcrumb wiring
  // ---------------------------------------------------------------------------

  const subWfStack = useSubWorkflowStack((s) => s.stack);
  const subWfRootFrame = useSubWorkflowStack((s) => s.rootFrame);

  const handleBreadcrumbJumpTo = useCallback(
    (targetWorkflowId: string) => {
      jumpToBreadcrumb({
        workflowId: targetWorkflowId,
        projectId: projectId ?? "",
        navigate: navigateWithGuard,
      });
    },
    [projectId, navigateWithGuard],
  );

  const handleBreadcrumbJumpToRoot = useCallback(() => {
    if (!subWfRootFrame) return;
    jumpToBreadcrumbRoot({
      rootFrame: subWfRootFrame,
      projectId: projectId ?? "",
      navigate: navigateWithGuard,
    });
  }, [subWfRootFrame, projectId, navigateWithGuard]);

  // When the user lands on the root workflow (URL matches rootFrame), clear
  // the stack so the breadcrumb disappears. This handles browser back/forward
  // and direct navigation without leaving a stale breadcrumb.
  const clearSubWfStack = useSubWorkflowStack((s) => s.clear);
  useEffect(() => {
    if (subWfRootFrame && workflowId === subWfRootFrame.workflowId) {
      clearSubWfStack();
    }
  }, [workflowId, subWfRootFrame, clearSubWfStack]);

  // ---------------------------------------------------------------------------
  // JSX
  // ---------------------------------------------------------------------------

  return (
    <NavigateWithGuardContext.Provider value={navigateWithGuard}>
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

      {subWfStack.length > 0 && subWfRootFrame && (
        <SubWorkflowBreadcrumb
          onJumpTo={handleBreadcrumbJumpTo}
          onJumpToRoot={handleBreadcrumbJumpToRoot}
        />
      )}

      <div className="flex-1 relative">
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
              onClick={() => setActiveTab("present")}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                activeTab === "present"
                  ? "text-[#ff0073] border-[#ff0073]"
                  : "text-[#64748B] dark:text-gray-400 border-transparent hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              <Monitor className="w-4 h-4" />
              Present
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

        {activeTab === "editor" && (
          <div className="absolute inset-0 overflow-hidden">
            <ReactFlowProvider>
              <EditorErrorBoundary label="Canvas">
                <WorkflowCanvas
                  sidebarVisible={sidebarVisible}
                  onToggleSidebar={() => setSidebarVisible((v) => !v)}
                />
              </EditorErrorBoundary>
              <NodeToolbar visible={sidebarVisible} />
              <EditorErrorBoundary label="Config panel">
                <ConfigPanel />
              </EditorErrorBoundary>
              {selectedPipelineId && (
                <EditorErrorBoundary label="Pipeline panel">
                  <PipelinePanel
                    pipelineId={selectedPipelineId}
                    onClose={() => useWorkflowStore.setState({ selectedNodeId: null })}
                  />
                </EditorErrorBoundary>
              )}
            </ReactFlowProvider>
            <div className={`absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 max-w-[calc(100%-2rem)]${isMobile && selectedNodeId ? " hidden" : ""}${configPanelFullscreen ? " hidden" : ""}`}>
              {isRunning && activeExecutionId ? (
                <ExecutionStatusBar
                  executionId={activeExecutionId}
                  onStopped={handleExecutionDiscarded}
                  onRunInstead={handleRunInstead}
                />
              ) : isRunning ? (
                <>
                  <Button
                    size="lg"
                    disabled
                    className="rounded-full px-6 text-white"
                    style={{ backgroundColor: "#ff0073" }}
                  >
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Executing workflow
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        className="rounded-lg bg-background h-9 px-2 gap-1"
                        title="Stop current execution"
                        aria-label="Stop current execution"
                      >
                        <Square className="w-3.5 h-3.5" />
                        <ChevronDown className="w-3 h-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64">
                      <DropdownMenuItem
                        onClick={() => withSingleDiscardConfirm(handleSingleNodeDiscard)}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Discard (save to Library, off canvas)
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => withSingleDiscardConfirm(() => {
                          handleSingleNodeDiscard();
                          handleRun(ctx, projectId, useWorkflowStore.getState().workflowId, save, setIsRunning, onExecutionStarted, onExecutionEnded);
                        })}
                      >
                        <RotateCcw className="w-4 h-4 mr-2" />
                        Run instead
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : isReadOnly ? (
                <>
                  <Button
                    size="lg"
                    variant="outline"
                    className="rounded-full px-5"
                    onClick={() => window.open(studioWorkflowUrl(useWorkflowStore.getState().workflowId ?? ""), "_blank", "noopener")}
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Open in Studio
                  </Button>
                  <Button
                    size="lg"
                    onClick={() => setRemixOpen(true)}
                    className={`rounded-full px-6 ${RUN_BUTTON_CLASS}`}
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    Clone &amp; Remix
                  </Button>
                </>
              ) : (
                <Button
                  size="lg"
                  disabled={hasCredits() && estimateLoading}
                  onClick={() => handleRun(ctx, projectId, useWorkflowStore.getState().workflowId, save, setIsRunning, onExecutionStarted, onExecutionEnded)}
                  className={`rounded-full px-6 ${RUN_BUTTON_CLASS}`}
                >
                  {hasCredits() && estimateLoading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 mr-2" />
                  )}
                  Execute workflow
                  {hasCredits() && !estimateLoading && workflowCreditEstimate > 0 && (
                    <span className="ml-2 opacity-80">
                      ({workflowCreditEstimate} CR)
                    </span>
                  )}
                </Button>
              )}
            </div>
          </div>
        )}

        {activeTab === "present" && (
          <div className="absolute inset-0">
            <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
              <PresentationViewLazy
                mode="tab"
                isOwner={true}
                onRun={isReadOnly ? undefined : () => handleRun(ctx, projectId, useWorkflowStore.getState().workflowId, save, setIsRunning, onExecutionStarted, onExecutionEnded)}
                isRunning={isRunning}
              />
            </Suspense>
          </div>
        )}

        {activeTab === "executions" && (
          <div className="absolute inset-0">
            <ExecutionsTab className="h-full" workflowId={useWorkflowStore.getState().workflowId} />
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

      <RemixProjectDialog open={remixOpen} onOpenChange={setRemixOpen} onConfirm={handleRemix} />

      <InsufficientCreditsModal
        open={showInsufficientCredits}
        onClose={() => setShowInsufficientCredits(false)}
        required={insufficientCreditsData?.required ?? 0}
        available={insufficientCreditsData?.available ?? 0}
        tier={insufficientCreditsData?.tier ?? "free"}
      />

      <StorageExceededModal
        open={showStorageExceeded}
        onClose={() => setShowStorageExceeded(false)}
        usedBytes={storageExceededData?.usedBytes ?? 0}
        quotaBytes={storageExceededData?.quotaBytes ?? 0}
        tier={storageExceededData?.tier ?? "free"}
      />

      {/* Quick-edit Prompt modal — opens for store.promptEditNodeId. Mounted at
          root so it survives a node's hover-toolbar unmounting mid-edit. */}
      <PromptQuickEditModal />

      {/* Confirm dialog for the fallback single-node discard / run-instead. */}
      <AlertDialog
        open={singleDiscardConfirm !== null}
        onOpenChange={(open) => { if (!open) setSingleDiscardConfirm(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this run?</AlertDialogTitle>
            <AlertDialogDescription>
              In-progress jobs can&apos;t be cancelled — they&apos;ll finish and be saved to My
              Library, but won&apos;t appear on the canvas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <Checkbox
              checked={singleDiscardDontAsk}
              onCheckedChange={(v) => setSingleDiscardDontAsk(v === true)}
            />
            Don&apos;t ask again
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSingleDiscardConfirm(null)}>Keep running</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (singleDiscardDontAsk) suppressDiscardConfirm();
                const action = singleDiscardConfirm;
                setSingleDiscardConfirm(null);
                action?.();
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isFreeCutOpen && (
        <Suspense fallback={null}>
          <FreeCutEditorModal
            videoUrl={freecutVideoUrl}
            freecutProjectUrl={freecutProjectUrl}
            additionalAssets={freecutAdditionalAssets}
            onExportComplete={handleFreeCutExport}
            onClose={handleFreeCutClose}
            onImportRequest={handleImportRequest}
            sendImportFilesRef={sendImportFilesRef}
          />
        </Suspense>
      )}

      {importPickerOpen && (
        <FreeCutImportPicker
          workflowAssets={allWorkflowAssets}
          accept={importPickerAccept}
          multiple={importPickerMultiple}
          onImport={handleImportFiles}
          onClose={() => setImportPickerOpen(false)}
        />
      )}

      {isImageEditOpen && (
        <Suspense fallback={null}>
          <FilerobotEditorModal
            imageUrl={imageEditUrl}
            designStateUrl={imageEditDesignStateUrl}
            onSaveComplete={handleImageEditSave}
            onClose={handleImageEditClose}
          />
        </Suspense>
      )}

      {characterStudioNodeId && (
        <Suspense fallback={null}>
          <CharacterStudioModal
            nodeId={characterStudioNodeId}
            onClose={() => setCharacterStudioNodeId(null)}
          />
        </Suspense>
      )}

      {locationStudioNodeId && (
        <Suspense fallback={null}>
          <LocationStudioModal
            nodeId={locationStudioNodeId}
            onClose={() => setLocationStudioNodeId(null)}
          />
        </Suspense>
      )}

      {objectStudioNodeId && (
        <Suspense fallback={null}>
          <ObjectStudioModal
            nodeId={objectStudioNodeId}
            onClose={() => setObjectStudioNodeId(null)}
          />
        </Suspense>
      )}
    </div>
    </NavigateWithGuardContext.Provider>
  );
}
