import { useCallback, useEffect, useRef, useState, useMemo, Suspense } from "react";
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry";
import { useNavigate } from "react-router-dom";
import { isExpandedClone } from "@nodaro-shared/clone-utils";
import { ReactFlowProvider } from "@xyflow/react";
import {
  Play,
  Loader2,
  Square,
  DollarSign,
  Layers,
  History,
  Monitor,
} from "lucide-react";
import { WorkflowCanvas } from "../workflow-canvas";
import { NodeToolbar } from "../node-toolbar";
import { ConfigPanel } from "../config-panel";
import { EditorToolbar } from "../editor-toolbar";
import { EditorErrorBoundary } from "../editor-error-boundary";
import { UnsavedChangesDialog } from "../unsaved-changes-dialog";
import { ExecutionsTab } from "../executions-tab";
import { ExecutionStatusBar } from "../execution-status-bar";
import { CostTab } from "../cost-tab";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useWorkflowPersistence } from "@/hooks/use-workflow-persistence";
import { useWorkflowStore } from "@/hooks/use-workflow-store";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useUndoRedoSubscription } from "@/hooks/use-undo-redo";
import { useProjectsStore } from "@/hooks/use-projects-store";
import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase";
import { StorageExceededError, uploadFile, setCurrentWorkflowId, cancelWorkflowExecution, cancelJob } from "@/lib/api";
import { queryClient } from "@/lib/query-client";
import { hasCredits } from "@/lib/edition";
import { getCachedCredits, prefetchModelCredits } from "@/hooks/use-model-credits";
import { getModelIdentifier } from "@/components/editor/config-panels/helpers";
import { useStats } from "@/hooks/queries/use-stats-queries";
import { InsufficientCreditsModal } from "@/components/credits/InsufficientCreditsModal";
import { StorageExceededModal } from "@/components/credits/StorageExceededModal";
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
} from "./run-handlers";
import { handleGenerateSceneImage as generateSceneImage, handleExpandStoryboard as expandStoryboard, handleCreateSceneNode as createSceneNode } from "./scene-story-handlers";
import { handleGenerateCharacterAsset, handleGenerateObjectAsset, handleGenerateLocationAsset } from "./asset-executors";
import { handleCreateNodesFromWriter as createNodesFromWriter, handleRunAllWriterImageNodes as runAllWriterImageNodes } from "./ai-writer-handlers";
import { resolveManualEdit } from "./execute-node";
import { extractNodeOutput } from "./execution-graph";
import { getOutputType } from "@nodaro-shared/presentation-utils";
import { FreeCutImportPicker } from "../freecut-import-picker";
import type { ManualEditData, GeneratedResult } from "@/types/nodes";
const FreeCutEditorModal = lazy(() => import("../freecut-editor-modal").then(m => ({ default: m.FreeCutEditorModal })));
const FilerobotEditorModal = lazy(() => import("../filerobot-editor-modal").then(m => ({ default: m.FilerobotEditorModal })));
const PresentationViewLazy = lazy(() => import("../../presentation/presentation-view").then(m => ({ default: m.PresentationView })));

interface WorkflowEditorProps {
  readonly projectId?: string;
  readonly workflowId?: string;
}

export function WorkflowEditor({ projectId, workflowId }: WorkflowEditorProps) {
  const { user } = useAuth();
  const { save, load, saving, loading } = useWorkflowPersistence(projectId);
  const fetchProjects = useProjectsStore((s) => s.fetchProjects);
  useUndoRedoSubscription();
  const navigate = useNavigate();
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [activeExecutionId, setActiveExecutionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"editor" | "present" | "executions" | "cost">(
    "editor",
  );
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const isMobile = useIsMobile();
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
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
    if (!manualEditNode || !allWorkflowAssets) return undefined;
    const connectedNodeIds = new Set(
      storeEdges.filter((e) => e.target === manualEditNode.id).map((e) => e.source),
    );
    return allWorkflowAssets.filter((a) => connectedNodeIds.has(a.nodeId));
  }, [manualEditNode, allWorkflowAssets, storeEdges]);

  const freecutVideoUrl = manualEditNode
    ? (manualEditConnectedAssets?.find(a => a.type === "video")?.url ?? meData?.inputVideoUrl ?? "")
    : (freecutEdit?.videoUrl ?? "");
  const freecutAdditionalAssets = manualEditNode
    ? manualEditConnectedAssets?.filter((a) => a.url !== freecutVideoUrl)
    : undefined;
  const freecutProjectUrl = manualEditNode
    ? (meData?.generatedResults?.[meData?.activeResultIndex ?? 0]?.freecutProjectUrl)
    : freecutEdit?.freecutProjectUrl;

  // ---------------------------------------------------------------------------
  // Filerobot image editor modal (universal edit from any image node)
  // ---------------------------------------------------------------------------

  const imageEdit = useWorkflowStore((s) => s.imageEdit);
  const closeImageEdit = useWorkflowStore((s) => s.closeImageEdit);

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
        const result = await uploadFile(file, user?.id);
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

        const newResult: GeneratedResult = { url, jobId: `freecut-edit-${Date.now()}`, timestamp: new Date().toISOString(), freecutProjectUrl: projectUrl };
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

        // Upload image and designState in parallel
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

        const [imageResult, designStateUrl] = await Promise.all([
          uploadImagePromise,
          uploadDesignStatePromise,
        ]);
        const url = imageResult.url;

        const newResult: GeneratedResult = {
          url,
          jobId: `image-edit-${Date.now()}`,
          timestamp: new Date().toISOString(),
          filerobotDesignStateUrl: designStateUrl,
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

  const { data: statsData } = useStats("user", user?.id, {
    refetchInterval: 30_000,
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
        nodes: structuredClone(state.nodes),
        edges: structuredClone(state.edges),
        settings: {
          characterDefinitions: structuredClone(state.characterDefinitions),
          flowPromptTemplates: structuredClone(state.flowPromptTemplates),
        },
      };

      fetch(`${supabaseUrl}/rest/v1/workflows?id=eq.${wfId}`, {
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
        current.nodes.length > 0
      ) {
        save(projectId);
      }
    }

    const unsub = useWorkflowStore.subscribe((state) => {
      if (state.isDirty && state.saveStatus !== "saving") {
        if (timer) clearTimeout(timer);
        timer = setTimeout(doSave, 3000);

        if (!maxTimer) {
          maxTimer = setTimeout(doSave, 10_000);
        }
      } else if (!state.isDirty) {
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

  function handleStop(): void {
    for (const interval of pollIntervalsRef.current) {
      clearInterval(interval);
    }
    pollIntervalsRef.current.clear();
    setIsRunning(false);

    // Cancel active backend jobs/executions
    const executionId = activeExecutionId;
    setActiveExecutionId(null);

    const { nodes, updateNodeData } = useWorkflowStore.getState();
    const jobIdsToCancel: string[] = [];
    for (const node of nodes) {
      const d = node.data as Record<string, unknown>;
      if (d.executionStatus === "running" || d.executionStatus === "pending") {
        updateNodeData(node.id, { executionStatus: "idle" });
        if (d.currentJobId) jobIdsToCancel.push(d.currentJobId as string);
      }
    }

    // Cancel workflow execution (covers backend orchestrator runs)
    if (executionId) {
      cancelWorkflowExecution(executionId).catch(() => {});
    }
    // Cancel individual standalone jobs via the dedicated job-cancel route
    // which also removes them from the BullMQ queue
    for (const jobId of jobIdsToCancel) {
      if (jobId !== executionId) {
        cancelJob(jobId).catch(() => {});
      }
    }

    // Refresh execution history after cancellations settle
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ["workflow-executions"] });
    }, 500);

    toast.info("Execution stopped");
  }

  // ---------------------------------------------------------------------------
  // Register store callbacks
  // ---------------------------------------------------------------------------

  useEffect(() => {
    useWorkflowStore.getState().setRunSingleNode(
      (nodeId: string) => handleRunSingleNode(nodeId, ctx, projectId, save, setIsRunning, pollIntervalsRef)
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
      (nodeId: string) => handleRunFromHere(nodeId, ctx, projectId, save, setIsRunning, onExecutionStarted, onExecutionEnded),
    );
    return () => useWorkflowStore.getState().setRunFromHere(null);
  });

  useEffect(() => {
    useWorkflowStore.getState().setRunSelected(
      () => handleRunSelected(ctx, projectId, save, setIsRunning, onExecutionStarted, onExecutionEnded),
    );
    return () => useWorkflowStore.getState().setRunSelected(null);
  });

  useEffect(() => {
    useWorkflowStore
      .getState()
      .setGenerateSceneImage((scriptNodeId: string, sceneIndex: number) =>
        generateSceneImage(scriptNodeId, sceneIndex, ctx),
      );
    return () => useWorkflowStore.getState().setGenerateSceneImage(null);
  });

  useEffect(() => {
    useWorkflowStore.getState().setExpandStoryboard(expandStoryboard);
    return () => useWorkflowStore.getState().setExpandStoryboard(null);
  });

  useEffect(() => {
    useWorkflowStore
      .getState()
      .setCreateSceneNodeFromScript(createSceneNode);
    return () => useWorkflowStore.getState().setCreateSceneNodeFromScript(null);
  });

  useEffect(() => {
    useWorkflowStore
      .getState()
      .setGenerateCharacterAssetFn(
        (nodeId: string, assetType: "expressions" | "poses" | "lighting" | "angles") =>
          handleGenerateCharacterAsset(nodeId, assetType, ctx),
      );
    return () => useWorkflowStore.getState().setGenerateCharacterAssetFn(null);
  });

  useEffect(() => {
    useWorkflowStore
      .getState()
      .setGenerateObjectAssetFn(
        (nodeId: string, assetType: "angles" | "materials" | "variations") =>
          handleGenerateObjectAsset(nodeId, assetType, ctx),
      );
    return () => useWorkflowStore.getState().setGenerateObjectAssetFn(null);
  });

  useEffect(() => {
    useWorkflowStore
      .getState()
      .setGenerateLocationAssetFn(
        (nodeId: string, assetType: "timeOfDay" | "weather" | "angles") =>
          handleGenerateLocationAsset(nodeId, assetType, ctx),
      );
    return () => useWorkflowStore.getState().setGenerateLocationAssetFn(null);
  });

  useEffect(() => {
    useWorkflowStore
      .getState()
      .setCreateNodesFromWriter(createNodesFromWriter);
    return () => useWorkflowStore.getState().setCreateNodesFromWriter(null);
  });

  useEffect(() => {
    useWorkflowStore
      .getState()
      .setRunAllWriterImageNodes((writerNodeId: string) =>
        runAllWriterImageNodes(writerNodeId, ctx, pollIntervalsRef),
      );
    return () => useWorkflowStore.getState().setRunAllWriterImageNodes(null);
  });

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts and navigation guards
  // ---------------------------------------------------------------------------

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
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
  // JSX
  // ---------------------------------------------------------------------------

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
            </ReactFlowProvider>
            <div className={`absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 max-w-[calc(100%-2rem)]${isMobile && selectedNodeId ? " hidden" : ""}`}>
              {isRunning && activeExecutionId ? (
                <ExecutionStatusBar
                  executionId={activeExecutionId}
                  onStopped={handleStop}
                />
              ) : isRunning ? (
                <>
                  <Button
                    size="lg"
                    onClick={handleStop}
                    className="rounded-full px-6 text-white"
                    style={{ backgroundColor: "#ff0073" }}
                  >
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Executing workflow
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleStop}
                    title="Stop current execution"
                    aria-label="Stop current execution"
                    className="rounded-lg bg-background"
                  >
                    <Square className="w-4 h-4" />
                  </Button>
                </>
              ) : (
                <Button
                  size="lg"
                  disabled={hasCredits() && estimateLoading}
                  onClick={() => handleRun(ctx, projectId, useWorkflowStore.getState().workflowId, save, setIsRunning, onExecutionStarted, onExecutionEnded)}
                  className="rounded-full px-6 text-white hover:opacity-90"
                  style={{ backgroundColor: "#ff0073" }}
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
                onRun={() => handleRun(ctx, projectId, useWorkflowStore.getState().workflowId, save, setIsRunning, onExecutionStarted, onExecutionEnded)}
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
    </div>
  );
}
