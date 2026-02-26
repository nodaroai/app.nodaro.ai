import { useCallback, useEffect, useRef, useState, useMemo, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { ReactFlowProvider } from "@xyflow/react";
import {
  Play,
  Loader2,
  Square,
  DollarSign,
  Layers,
  History,
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
import { useUndoRedoSubscription } from "@/hooks/use-undo-redo";
import { useProjectsStore } from "@/hooks/use-projects-store";
import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase";
import { StorageExceededError, uploadFile } from "@/lib/api";
import { hasCredits } from "@/lib/edition";
import { getCachedCredits } from "@/hooks/use-model-credits";
import { useStats } from "@/hooks/queries/use-stats-queries";
import { InsufficientCreditsModal } from "@/components/credits/InsufficientCreditsModal";
import { StorageExceededModal } from "@/components/credits/StorageExceededModal";
import {
  NODE_CREDIT_COSTS,
  isExecutableNode,
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
import type { ManualEditData, GeneratedResult } from "@/types/nodes";
const FreeCutEditorModal = lazy(() => import("../freecut-editor-modal").then(m => ({ default: m.FreeCutEditorModal })));

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
  const [activeTab, setActiveTab] = useState<"editor" | "executions" | "cost">(
    "editor",
  );
  const [sidebarVisible, setSidebarVisible] = useState(false);
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
  const [showStorageExceeded, setShowStorageExceeded] = useState(false);
  const [storageExceededData, setStorageExceededData] = useState<{
    usedBytes: number;
    quotaBytes: number;
    tier: string;
  } | null>(null);

  // ---------------------------------------------------------------------------
  // Manual-edit FreeCut modal
  // ---------------------------------------------------------------------------

  const storeNodes = useWorkflowStore((s) => s.nodes);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);

  const manualEditNode = useMemo(
    () => storeNodes.find((n) => n.type === "manual-edit" && (n.data as ManualEditData).isEditorOpen),
    [storeNodes],
  );

  const handleFreeCutExport = useCallback(
    async (blob: Blob) => {
      if (!manualEditNode) return;
      const nodeId = manualEditNode.id;
      try {
        const file = new File([blob], "manual-edit.mp4", { type: "video/mp4" });
        const result = await uploadFile(file, user?.id);
        const url = result.url;
        const newResult: GeneratedResult = { url, jobId: `manual-edit-${Date.now()}`, timestamp: new Date().toISOString() };
        const freshNode = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId);
        const prev = freshNode ? ((freshNode.data as ManualEditData).generatedResults ?? []) : [];
        updateNodeData(nodeId, {
          executionStatus: "completed",
          generatedVideoUrl: url,
          generatedResults: [...prev, newResult],
          activeResultIndex: prev.length,
          isEditorOpen: false,
        });
        resolveManualEdit(nodeId);
      } catch (err) {
        if (err instanceof StorageExceededError) {
          setShowStorageExceeded(true);
          setStorageExceededData({ usedBytes: err.usedBytes, quotaBytes: err.quotaBytes, tier: err.tier });
        }
        updateNodeData(nodeId, {
          executionStatus: "failed",
          errorMessage: err instanceof Error ? err.message : "Upload failed",
          isEditorOpen: false,
        });
      }
    },
    [manualEditNode, user?.id, updateNodeData],
  );

  const handleFreeCutClose = useCallback(() => {
    if (!manualEditNode) return;
    updateNodeData(manualEditNode.id, { isEditorOpen: false });
  }, [manualEditNode, updateNodeData]);

  // ---------------------------------------------------------------------------
  // Credit estimate
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!hasCredits()) return;
    const executableNodes = storeNodes.filter((n) => isExecutableNode(n));
    const total = executableNodes.reduce((sum, node) => {
      const data = node.data as Record<string, unknown>;
      const provider = data.provider as string | undefined;
      if (provider) {
        const cached = getCachedCredits(provider);
        if (cached !== undefined) return sum + cached;
      }
      return sum + (NODE_CREDIT_COSTS[node.type ?? ""] ?? 1);
    }, 0);
    setWorkflowCreditEstimate(total);
  }, [storeNodes]);

  const { data: statsData } = useStats("user", user?.id, {
    refetchInterval: 30_000,
  });
  const activeJobCount =
    (statsData?.pending ?? 0) + (statsData?.processing ?? 0);

  // ---------------------------------------------------------------------------
  // Workflow loading and lifecycle
  // ---------------------------------------------------------------------------

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
  }, []);

  const onExecutionEnded = useCallback(() => {
    setActiveExecutionId(null);
  }, []);

  function handleStop(): void {
    for (const interval of pollIntervalsRef.current) {
      clearInterval(interval);
    }
    pollIntervalsRef.current.clear();
    setIsRunning(false);
    setActiveExecutionId(null);

    const { nodes, updateNodeData } = useWorkflowStore.getState();
    for (const node of nodes) {
      if (
        (node.data as Record<string, unknown>).executionStatus === "running"
      ) {
        updateNodeData(node.id, { executionStatus: "idle" });
      }
    }
    toast.info("Execution stopped");
  }

  // ---------------------------------------------------------------------------
  // Register store callbacks
  // ---------------------------------------------------------------------------

  useEffect(() => {
    useWorkflowStore.getState().setRunSingleNode(
      (nodeId: string) => handleRunSingleNode(nodeId, ctx, projectId, save, setIsRunning, pollIntervalsRef),
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
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2">
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
                  onClick={() => handleRun(ctx, projectId, useWorkflowStore.getState().workflowId, save, setIsRunning, onExecutionStarted, onExecutionEnded)}
                  className="rounded-full px-6 text-white hover:opacity-90"
                  style={{ backgroundColor: "#ff0073" }}
                >
                  <Play className="w-4 h-4 mr-2" />
                  Execute workflow
                  {hasCredits() && workflowCreditEstimate > 0 && (
                    <span className="ml-2 opacity-80">
                      ({workflowCreditEstimate} CR)
                    </span>
                  )}
                </Button>
              )}
            </div>
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

      {manualEditNode && (
        <Suspense fallback={null}>
          <FreeCutEditorModal
            videoUrl={(manualEditNode.data as ManualEditData).inputVideoUrl ?? ""}
            onExportComplete={handleFreeCutExport}
            onClose={handleFreeCutClose}
          />
        </Suspense>
      )}
    </div>
  );
}
