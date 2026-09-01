"use client";

import { useState, useEffect, useRef, useMemo, useCallback, Suspense, lazy, type ReactNode } from "react";
import { useSurfaceAvailability } from "@/lib/surface-availability"
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  Clock,
  Download,
  Filter,
  HardDrive,
  Layers,
  Link2,
  Merge,
  Puzzle,
  Search,
  SlidersHorizontal,
  UserPlus,
  Webhook,
  Workflow,
} from "lucide-react";
import type { Connection } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { useClickOutside } from "@/hooks/use-click-outside";
import { clusterByGroup } from "@/lib/cluster-by-group";
import { categoryRank } from "@/lib/node-category-order";
import type { SceneNodeType } from "@/types/nodes";
import type { ConnectionContext, NodeOption } from "@/lib/node-compatibility";
import { getCompatibleNodes, resolveTargetHandle, PARAMETER_ACCEPTING_HANDLE_IDS } from "@/lib/node-compatibility";
import { buildPrefillInitialData } from "@/lib/node-name-field";
import {
  readAddNodeMenuTab,
  persistAddNodeMenuTab,
  nextAddNodeMenuTab,
  readCreativeControlsOpen,
  persistCreativeControlsOpen,
  type AddNodeMenuTab,
} from "@/lib/add-node-menu-tab";
import { sectionsForTab, tabTypeSet } from "@/lib/node-picker-sections";
import { familyLabel } from "@/lib/node-families";
import {
  SearchOwnBlock,
  SearchOtherBlock,
  SearchEmptyState,
} from "./add-node-popup/picker-search-results";
import { COMMON_SECTIONS as COMMON_TAB_SECTIONS } from "@/lib/node-families";
import { PickerTabBar } from "./add-node-popup/picker-tab-bar";
import {
  PickerSectionList,
  flattenSections,
  isCreativeControlsNavItem,
} from "./add-node-popup/picker-section-list";
import { searchModelVariants, type ModelKind, type ModelTreeVariant } from "@nodaro/shared"
import { ScrollArea } from "@/components/ui/scroll-area";
import { useT, type MessageKey } from "@/lib/i18n";
import { useLocalizeNodeLabel, useLocalizeNodeGroup } from "@/lib/i18n/labels";
import { useAuth } from "@/hooks/use-auth";
import { useUserSettings } from "@/hooks/queries/use-user-settings-queries";
import { useNodeSelectionHistoryStore, type HistoryEntry } from "@/hooks/use-node-selection-history-store";
import { useWorkflowStore } from "@/hooks/use-workflow-store";
import { Switch } from "@/components/ui/switch";
import { enumerateConnectionOptionsCore } from "@/lib/enumerate-connection-options";
import { getAutoConnectPref, setAutoConnectPref } from "@/lib/auto-connect-pref";

const ComponentMarketplaceModal = lazy(() => import("./component-marketplace-modal").then(m => ({ default: m.ComponentMarketplaceModal })));
import type { ComponentSelection } from "./component-marketplace-modal";
import { ModelsTab, VariantRow, variantToSelection, type ModelSelection } from "./models-tab";

const EMPTY_SET = new Set<string>();

// The catalogue lives in @/lib/node-options so the sidebar can share it.
// Re-exported here because tests and sibling modules import it from this
// path; keeping the shim means the consolidation touches no import site.
import { NODE_OPTIONS, getNodeOptions } from "@/lib/node-options"
export { NODE_OPTIONS, getNodeOptions }


export const VIRTUAL_CATEGORY_IDS = {
  recent: "Recent",
  common: "Common",
  commonPickers: "Common Pickers",
  models: "Models",
} as const;

const isNodeOption = (n: NodeOption | undefined): n is NodeOption => Boolean(n);

function mapHistoryToOptions(
  history: ReadonlyArray<HistoryEntry>,
  compare: (a: HistoryEntry, b: HistoryEntry) => number,
  optionByType: Map<SceneNodeType, NodeOption>,
): NodeOption[] {
  return history
    .slice()
    .sort(compare)
    .map((h) => optionByType.get(h.nodeType))
    .filter(isNodeOption);
}

/** Set view of the Common tab's membership, derived from the family registry
 *  so the two can never disagree. Search ranking puts these before
 *  non-common matches. */
export const COMMON_NODE_TYPES: ReadonlySet<SceneNodeType> = new Set(
  COMMON_TAB_SECTIONS.flatMap((s) => s.types),
);

// label/description are MessageKeys, localized at the render site (CATEGORIES
// is a module-level const — it can't call the useT hook itself).
export const CATEGORIES = [
  {
    id: VIRTUAL_CATEGORY_IDS.recent,
    labelKey: "nodecat.Recent" as MessageKey,
    icon: <Clock className="h-4 w-4" />,
    descKey: "addnode.catDescRecent" as MessageKey,
  },
  // "Common" is deliberately NOT a category here — it's the popup's Common
  // tab (see the tablist above the search box). The All tab shows this list.
  {
    id: "AI",
    labelKey: "nodecat.AI" as MessageKey,
    icon: <BookOpen className="h-4 w-4" />,
    descKey: "addnode.catDescAI" as MessageKey,
  },
  {
    id: "Input",
    labelKey: "nodecat.Input" as MessageKey,
    icon: <Download className="h-4 w-4" />,
    descKey: "addnode.catDescInput" as MessageKey,
  },
  {
    id: "Triggers",
    labelKey: "nodecat.Triggers" as MessageKey,
    icon: <Webhook className="h-4 w-4" />,
    descKey: "addnode.catDescTriggers" as MessageKey,
  },
  {
    id: "Data",
    labelKey: "nodecat.Data" as MessageKey,
    icon: <Filter className="h-4 w-4" />,
    descKey: "addnode.catDescData" as MessageKey,
  },
  // Parameter category section is hidden — all Parameter-typed nodes are
  // already filtered out of `visibleNodes` (search for `n.category !== "Parameter"`),
  // so the section header was showing as an empty pane. Re-enable by restoring
  // the entry below alongside dropping the `visibleNodes` filter.
  // {
  //   id: "Parameter",
  //   label: "PARAMETER",
  //   icon: <SlidersHorizontal className="h-4 w-4" />,
  //   description: "Tone, Style, Duration",
  // },
  {
    id: "Pickers",
    labelKey: "nodecat.Pickers" as MessageKey,
    icon: <SlidersHorizontal className="h-4 w-4" />,
    descKey: "addnode.catDescPickers" as MessageKey,
  },
  {
    id: "Processing",
    labelKey: "nodecat.Processing" as MessageKey,
    icon: <Merge className="h-4 w-4" />,
    descKey: "addnode.catDescProcessing" as MessageKey,
  },
  {
    id: "Assets",
    labelKey: "nodecat.Assets" as MessageKey,
    icon: <UserPlus className="h-4 w-4" />,
    descKey: "addnode.catDescAssets" as MessageKey,
  },
  {
    id: "Output",
    labelKey: "nodecat.Output" as MessageKey,
    icon: <HardDrive className="h-4 w-4" />,
    descKey: "addnode.catDescOutput" as MessageKey,
  },
  {
    id: "Workflow",
    labelKey: "nodecat.Workflow" as MessageKey,
    icon: <Workflow className="h-4 w-4" />,
    descKey: "addnode.catDescWorkflow" as MessageKey,
  },
  {
    id: "Component",
    labelKey: "nodecat.Component" as MessageKey,
    icon: <Puzzle className="h-4 w-4" />,
    descKey: "addnode.catDescComponent" as MessageKey,
  },
  // Models is a popup-only virtual root: it opens the series → variants model
  // browser (same as the Models tab). categoryRank pins it last in the All tab.
  {
    id: VIRTUAL_CATEGORY_IDS.models,
    labelKey: "nodecat.Models" as MessageKey,
    icon: <Layers className="h-4 w-4" />,
    descKey: "addnode.catDescModels" as MessageKey,
  },
].sort((a, b) => categoryRank(a.id) - categoryRank(b.id));

/**
 * Node-category display name -> message key. Explicit map (not a template
 * literal + cast) so a renamed category is a compile error, not a raw
 * "nodecat.Foo" leaking into the UI. Unknown categories fall back to the
 * original string.
 */
const NODE_CATEGORY_KEYS: Record<string, MessageKey> = {
  Recent: "nodecat.Recent",
  Common: "nodecat.Common",
  Input: "nodecat.Input",
  Triggers: "nodecat.Triggers",
  Data: "nodecat.Data",
  Parameter: "nodecat.Parameter",
  Pickers: "nodecat.Pickers",
  AI: "nodecat.AI",
  Processing: "nodecat.Processing",
  Assets: "nodecat.Assets",
  Output: "nodecat.Output",
  Workflow: "nodecat.Workflow",
  Component: "nodecat.Component",
};

/** Filter a node pool by a search query (label / type / category / keywords)
 *  and rank the matches: direct-match tier first (edge-drop context), then
 *  COMMON nodes, then the rest — pool order preserved within each bucket
 *  (Array.prototype.sort is stable). */
export function searchNodeOptions(
  pool: ReadonlyArray<NodeOption>,
  query: string,
  directTypes: ReadonlySet<string> = EMPTY_SET,
  // The popup renders localized names, so search must match them too — otherwise
  // a Hebrew user sees "יצירת תמונה" but can only find it by typing the English
  // "Generate Image". Pass the localizer and the visible name becomes findable.
  localize?: (label: string) => string,
): NodeOption[] {
  const q = query.toLowerCase();
  const directTier = (n: NodeOption) => (directTypes.has(n.type) ? 0 : 1);
  const commonTier = (n: NodeOption) => (COMMON_NODE_TYPES.has(n.type) ? 0 : 1);
  return pool
    .filter(
      (node) =>
        node.label.toLowerCase().includes(q) ||
        (localize?.(node.label).toLowerCase().includes(q) ?? false) ||
        node.type.toLowerCase().includes(q) ||
        node.category.toLowerCase().includes(q) ||
        (node.keywords?.some((kw) => kw.toLowerCase().includes(q)) ?? false),
    )
    .sort((a, b) => directTier(a) - directTier(b) || commonTier(a) - commonTier(b));
}

/** Tab-aware search: on the Common / Image / Video / Audio tabs the active
 *  tab's own items come first and every remaining match lands in `other`
 *  (rendered under an "Other" section). The All tab stays flat. Both blocks
 *  keep the searchNodeOptions ranking (direct tier, then common, then pool
 *  order). */
export function searchNodeOptionsSectioned(
  pool: ReadonlyArray<NodeOption>,
  query: string,
  tab: AddNodeMenuTab,
  directTypes: ReadonlySet<string> = EMPTY_SET,
  localize?: (label: string) => string,
): { own: NodeOption[]; other: NodeOption[] } {
  const ranked = searchNodeOptions(pool, query, directTypes, localize);
  // "all"/"models" are flat at the node level (all matches in `own`); the popup
  // interleaves model hits around them per SEARCH_BLOCK_ORDER below.
  if (tab === "all" || tab === "models") return { own: ranked, other: [] };
  // "On this tab" means exactly what browsing the tab renders — families,
  // superset members and Creative Controls — so a match can never be filed
  // under "From other tabs" while sitting in plain sight on this one.
  const ownSet = tabTypeSet(pool, tab);
  return {
    own: ranked.filter((n) => ownSet.has(n.type)),
    other: ranked.filter((n) => !ownSet.has(n.type)),
  };
}

/** A row in the unified node+model search list (drives render AND keyboard nav). */
type SearchRow = { kind: "node"; node: NodeOption } | { kind: "model"; model: ModelTreeVariant };
export type SearchBlock = "nodeOwn" | "models" | "nodeOther";

/** Per-tab order of the three search blocks (§4/§5). Image/Video/Audio surface
 *  that-kind models right after their media nodes; Models leads with all models;
 *  All appends all models after the nodes; Common appends all models last. Each
 *  value is a permutation of the three blocks (guarded by a test). */
export const SEARCH_BLOCK_ORDER: Record<AddNodeMenuTab, readonly SearchBlock[]> = {
  image: ["nodeOwn", "models", "nodeOther"],
  video: ["nodeOwn", "models", "nodeOther"],
  audio: ["nodeOwn", "models", "nodeOther"],
  models: ["models", "nodeOwn", "nodeOther"],
  all: ["nodeOwn", "models", "nodeOther"],
  common: ["nodeOwn", "nodeOther", "models"],
  // The non-media intent tabs have no model affinity, so models trail the
  // cross-tab matches rather than splitting the two node blocks apart.
  assets: ["nodeOwn", "nodeOther", "models"],
  automate: ["nodeOwn", "nodeOther", "models"],
  publish: ["nodeOwn", "nodeOther", "models"],
};

/** "From other tabs" is deliberately explicit: a search must never look like
 *  a dead end just because the match lives on a different tab. */
const SEARCH_BLOCK_HEADER: Record<SearchBlock, MessageKey> = { nodeOwn: "addnode.blockNodes", models: "addnode.blockModels", nodeOther: "addnode.blockOther" };

/** The model kind a media tab PRIORITIZES in search (sorts first, never filters);
 *  undefined = no kind preference (Models/All/Common show every model in order). */
const TAB_MODEL_KIND: Partial<Record<AddNodeMenuTab, ModelKind>> = { image: "image", video: "video", audio: "audio" };

/** A labeled pink Switch — the Auto Connect / Smart toggles in the search bar. */
function ToggleLabel({
  icon,
  label,
  checked,
  onChange,
  ariaLabel,
  title,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (v: boolean) => void;
  readonly ariaLabel: string;
  readonly title: string;
}) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer select-none" title={title}>
      {icon}
      <span className="text-[11px] font-semibold text-[var(--npk-badge-text)] whitespace-nowrap">{label}</span>
      <Switch size="sm" checked={checked} onCheckedChange={onChange} aria-label={ariaLabel} className="data-[state=checked]:bg-[var(--npk-accent)]" />
    </label>
  );
}

/** Green badge marking a node that can wire to the focused node:
 *  "connects" in Tab-auto-connect, "direct" in edge-drop. */
function MatchBadge({ label, className }: { label: string; className?: string }) {
  return (
    <span className={cn("text-[12px] text-[var(--npk-match)] font-medium flex items-center gap-1 shrink-0", className)}>
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--npk-match)]" />
      {label}
    </span>
  );
}

interface AddNodePopupProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onAddNode: (type: SceneNodeType, initialData?: Record<string, unknown>) => void;
  readonly position?: { x: number; y: number };
  readonly connectionContext?: ConnectionContext | null;
  readonly storeAddNode?: (type: SceneNodeType, position: { x: number; y: number }, initialData?: Record<string, unknown>) => string | undefined;
  readonly storeOnConnect?: (connection: Connection) => void;
  /** Pre-select a category drill-down on open (e.g. "Input") instead of the
   *  top-level category list. Used by the editor empty-state's upload bar. */
  readonly initialCategory?: string | null;
  /** Tab-auto-connect mode: the focused node to wire the new node to, with its
   *  rendered handle ids (sourced from React Flow `handleBounds` by the caller).
   *  When set + the Auto toggle is on, selecting a node hands off to the Connect
   *  dialog via `onPickType` instead of creating immediately. */
  readonly autoConnectCtx?: {
    readonly nodeId: string;
    readonly nodeType: string;
    readonly focusedLabel: string;
    readonly sourceHandles: readonly string[];
    readonly targetHandles: readonly string[];
  } | null;
  readonly onPickType?: (type: SceneNodeType, initialData?: Record<string, unknown>) => void;
}

export function AddNodePopup({
  open,
  onClose,
  onAddNode,
  position,
  connectionContext,
  storeAddNode,
  storeOnConnect,
  initialCategory,
  autoConnectCtx,
  onPickType,
}: AddNodePopupProps) {
  const t = useT();
  // Unknown category -> render the raw English rather than mislabelling it.
  const nodeCategory = (c: string): string => {
    const key = NODE_CATEGORY_KEYS[c];
    return key ? t(key) : c;
  };
  // Node display names come from NODE_OPTIONS (English canonical); this maps
  // them through the shared node-label table so the list matches the canvas.
  const localizeNode = useLocalizeNodeLabel();
  const localizeGroup = useLocalizeNodeGroup();
  const { isAdmin, user } = useAuth();
  const { data: userSettings } = useUserSettings(user?.id);
  const openPickerForNode = useWorkflowStore((s) => s.openPickerForNode);
  const showRecentNodes = userSettings?.showRecentNodes ?? false;
  const history = useNodeSelectionHistoryStore((s) => s.history);
  const recordSelection = useNodeSelectionHistoryStore((s) => s.recordSelection);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  // Common/All mode (the tablist above the search box). The last explicit
  // user choice is remembered across sessions.
  const [activeTab, setActiveTab] = useState<AddNodeMenuTab>(readAddNodeMenuTab);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [componentBrowserOpen, setComponentBrowserOpen] = useState(false);
  // Creative Controls stay collapsed by default and remember their state for
  // the session (sessionStorage, so a new tab starts collapsed again).
  const [creativeControlsOpen, setCreativeControlsOpen] = useState(readCreativeControlsOpen);
  const toggleCreativeControls = useCallback(() => {
    setCreativeControlsOpen((prev) => {
      persistCreativeControlsOpen(!prev);
      return !prev;
    });
  }, []);
  // Auto-connect toggle (Tab-from-focused-node). Seeded from localStorage; the
  // live value lets the user flip it within the open popup.
  const [autoConnect, setAutoConnect] = useState(getAutoConnectPref);
  // Smart Connect's toggle is intentionally hidden (the feature is force-OFF in
  // auto-connect-pref.ts, so picking a node always opens the Connect dialog).
  const popupRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Switch Common/All. Refocusing the search input keeps keystrokes flowing
  // to the popup after mouse interactions — the canvas's capture-phase
  // shortcut handler skips events only when an editable element has focus.
  const switchTab = useCallback((tab: AddNodeMenuTab) => {
    setActiveTab(tab);
    persistAddNodeMenuTab(tab);
    setSelectedCategory(null);
    searchInputRef.current?.focus();
  }, []);

  // The availability sets arrive after first paint; without this the picker
  // keeps offering nodes this deployment does not allow.
  const availability = useSurfaceAvailability()

  // Compatibility pool. Parameter-category nodes stay OUT of it: edge-drop
  // reaches them through the typed-handle pool below, and letting them into
  // the generic compatibility tiers would offer a Duration node on handles
  // that cannot consume one.
  const visibleNodes = useMemo(
    () => getNodeOptions().filter((n) => (!n.adminOnly || isAdmin) && n.category !== "Parameter"),
    [isAdmin, availability],
  );

  // Browse + search pool. Unlike `visibleNodes` this DOES include the seven
  // Parameter nodes — the redesign surfaces them under Models · Generation
  // Settings instead of leaving them reachable only by dragging a wire.
  const browsePool = useMemo(
    () => getNodeOptions().filter((n) => !n.adminOnly || isAdmin),
    [isAdmin, availability],
  );

  // Typed-handle pool: Parameter-category nodes are normally hidden from
  // the popup browse view, but they MUST be available as candidates for
  // certain typed-handle edge drops. Example: `tone` (Parameter) is a
  // registered HINT_PRODUCER, so dragging from camera-motion's
  // startState should surface tone in the suggestions.
  //
  // Gated on `PARAMETER_ACCEPTING_HANDLE_IDS` — the NARROWER set of typed
  // handles that need Parameter-category candidates (startState/endState/
  // target). The broader TYPED_HANDLE_IDS includes "in" for ffmpeg
  // consumer dispatch, but ffmpeg `in` handles accept video/audio/dynamic
  // producers — all in core categories. Routing every "in" drag through
  // the unfiltered pool would surface tone / lens / mood as candidates
  // on every non-ffmpeg `in` handle (text-to-speech, voice-*, motion-
  // graphics, after-effects, transcribe, etc.) — false-positive UX.
  const typedHandlePool = useMemo(
    () => getNodeOptions().filter((n) => !n.adminOnly || isAdmin),
    [isAdmin, availability],
  );

  // Compatibility filtering for per-handle edge-drop (connectionContext): render
  // the Direct/Compatible tiers + hide the tabs. (Tab-auto-connect is NOT filtered
  // — it shows the full list and just marks connectable nodes; see directMatchTypes.)
  const { compatibilityNodes, isFiltered } = useMemo(() => {
    if (connectionContext) {
      const usesTypedPool =
        connectionContext.direction === "target" &&
        PARAMETER_ACCEPTING_HANDLE_IDS.has(connectionContext.handleId);
      const pool = usesTypedPool ? typedHandlePool : visibleNodes;
      const result = getCompatibleNodes(connectionContext.handleId, connectionContext.direction, pool, connectionContext.nodeType);
      if (result.direct.length === 0 && result.compatible.length === 0) {
        return { compatibilityNodes: null, isFiltered: false };
      }
      return { compatibilityNodes: result, isFiltered: true };
    }
    return { compatibilityNodes: null, isFiltered: false };
    // PARAMETER_ACCEPTING_HANDLE_IDS is a stable module-level const.
  }, [connectionContext, visibleNodes, typedHandlePool]);

  // Handle node selection — auto-connects edge when connectionContext is present
  const handleNodeSelect = useCallback(
    (type: SceneNodeType) => {
      if (type === "component") {
        setComponentBrowserOpen(true);
        return;
      }
      recordSelection(type);
      if (connectionContext && storeAddNode && storeOnConnect) {
        // Sequence: create node → wire edge → open picker. Opening the
        // picker AFTER `storeOnConnect` is intentional — config panels for
        // tile-grid pickers (e.g. CameraMotionConfig) read `edges` on mount
        // to compose preview hints; if the panel opens before the edge
        // lands, the first render is missing the upstream context and the
        // user sees a one-frame flash of an incomplete preview.
        const newNodeId = storeAddNode(
          type,
          connectionContext.dropPosition,
          buildPrefillInitialData(type, connectionContext.prefillName),
        );
        if (!newNodeId) {
          onClose();
          return;
        }
        const resolvedHandle = resolveTargetHandle(type, connectionContext.handleId, connectionContext.direction);
        const connection: Connection =
          connectionContext.direction === "source"
            ? {
                source: connectionContext.nodeId,
                sourceHandle: connectionContext.handleId,
                target: newNodeId,
                targetHandle: resolvedHandle,
              }
            : {
                source: newNodeId,
                sourceHandle: resolvedHandle,
                target: connectionContext.nodeId,
                targetHandle: connectionContext.handleId,
              };
        storeOnConnect(connection);
        openPickerForNode(newNodeId, type);
        onClose();
      } else if (autoConnect && autoConnectCtx && onPickType) {
        // Tab-auto-connect: defer creation to the Connect dialog (name + handle).
        // Do NOT onClose() here — the canvas hides the popup and hands off to the
        // Connect dialog (or wires immediately when Smart Connect is on).
        onPickType(type);
      } else {
        onAddNode(type);
        onClose();
      }
    },
    [connectionContext, storeAddNode, storeOnConnect, onAddNode, onClose, recordSelection, openPickerForNode, autoConnect, autoConnectCtx, onPickType],
  );

  // Handle component selected from marketplace modal
  const handleComponentSelect = useCallback(
    (component: ComponentSelection) => {
      onAddNode("component", component as unknown as Record<string, unknown>);
      onClose();
    },
    [onAddNode, onClose],
  );

  // Models tab: a model variant was picked. Seed the node it runs on with the
  // chosen provider/model field, then create it — deferring to the auto-connect
  // Connect dialog when that flow is active (same handoff as handleNodeSelect).
  const handleSelectModel = useCallback(
    (sel: ModelSelection) => {
      const initialData = sel.field ? ({ [sel.field]: sel.value } as Record<string, unknown>) : undefined;
      if (autoConnect && autoConnectCtx && onPickType) {
        // Hand off to the canvas (Smart Connect or the Connect dialog). Do NOT
        // onClose() — mirrors handleNodeSelect: the canvas hides the popup and the
        // Connect dialog (or immediate wiring) takes over.
        onPickType(sel.nodeType as SceneNodeType, initialData);
        return;
      }
      onAddNode(sel.nodeType as SceneNodeType, initialData);
      onClose();
    },
    [autoConnect, autoConnectCtx, onPickType, onAddNode, onClose],
  );

  // Effective node pool: filtered by compatibility when edge-dropping, otherwise all visible
  const effectivePool = useMemo(() => {
    if (!isFiltered || !compatibilityNodes) return visibleNodes;
    return [...compatibilityNodes.direct, ...compatibilityNodes.compatible];
  }, [visibleNodes, isFiltered, compatibilityNodes]);

  // Auto-connect marking: node types that have ≥1 valid connection option with
  // the focused node. Reuses the same enumerator as the Connect dialog so the
  // mark and the dialog can't disagree. Skipped while `isFiltered` — edge-drop
  // already supplies the badge set via compatibilityNodes.directTypes, so the
  // ~150 enumerations here would be computed and thrown away every render.
  const autoConnectActive = autoConnect && !!autoConnectCtx;
  const autoConnectMatchTypes = useMemo(() => {
    if (!autoConnectActive || !autoConnectCtx || isFiltered) return EMPTY_SET;
    const matched = new Set<SceneNodeType>();
    for (const node of visibleNodes) {
      if (node.type === autoConnectCtx.nodeType) continue;
      const { handles } = enumerateConnectionOptionsCore({
        focusedType: autoConnectCtx.nodeType,
        newType: node.type,
        focusedSourceHandles: autoConnectCtx.sourceHandles,
        focusedTargetHandles: autoConnectCtx.targetHandles,
        missingRefNames: [],
      });
      if (handles.length > 0) matched.add(node.type);
    }
    return matched;
  }, [autoConnectActive, autoConnectCtx, visibleNodes, isFiltered]);

  const directMatchTypes = isFiltered && compatibilityNodes
    ? compatibilityNodes.directTypes
    : autoConnectActive
      ? autoConnectMatchTypes
      : EMPTY_SET;
  // Edge-drop has a real two-tier vocabulary (a "Direct Match" section vs
  // "Compatible"); Tab-auto-connect instead marks every node that can wire to the
  // focused node in EITHER direction, which reads better as "connects" than "direct".
  const matchLabel = isFiltered ? t("addnode.badgeDirect") : t("addnode.badgeConnects");

  const optionByType = useMemo(() => {
    const map = new Map<SceneNodeType, NodeOption>();
    for (const node of effectivePool) map.set(node.type, node);
    return map;
  }, [effectivePool]);

  const searchActive = !!searchQuery.trim();
  // The Models tab AND the All-tab "Models" category share one view: the model
  // browser when idle, the models-first unified search when typing.
  const inModelsView = activeTab === "models" || selectedCategory === VIRTUAL_CATEGORY_IDS.models;
  // The tab whose affinity drives search layout. Edge-drop is flat ("all"); the
  // Models view ranks models first regardless of activeTab.
  const searchTab: AddNodeMenuTab = isFiltered ? "all" : inModelsView ? "models" : activeTab;

  // Node matches, sectioned (own first, then "other"); flat on all/models.
  const searchSections = useMemo(() => {
    if (!searchActive) return null;
    // Search spans the browse pool so the Generation Settings nodes are
    // findable by name, not only by dragging a compatible wire.
    return searchNodeOptionsSectioned(
      isFiltered ? effectivePool : browsePool,
      searchQuery,
      searchTab,
      directMatchTypes,
      localizeNode,
    );
  }, [searchActive, effectivePool, browsePool, isFiltered, searchQuery, searchTab, directMatchTypes, localizeNode]);

  // ALL matching models (never filtered by tab) — just ordered so the active
  // media tab's own kind leads. Suppressed in edge-drop (connection-driven).
  const modelHits = useMemo<ModelTreeVariant[]>(() => {
    if (!searchActive || isFiltered) return [];
    const all = searchModelVariants(searchQuery);
    const kind = TAB_MODEL_KIND[searchTab];
    // Show every model, the active media tab's own kind first (stable partition).
    return kind ? [...all.filter((m) => m.kind === kind), ...all.filter((m) => m.kind !== kind)] : all;
  }, [searchActive, isFiltered, searchQuery, searchTab]);

  // Non-empty blocks in this tab's order — drives both render and keyboard nav.
  const searchBlocks = useMemo(() => {
    if (!searchActive) return null;
    const own = searchSections?.own ?? [];
    const other = searchSections?.other ?? [];
    const byBlock: Record<SearchBlock, SearchRow[]> = {
      nodeOwn: own.map((node): SearchRow => ({ kind: "node", node })),
      nodeOther: other.map((node): SearchRow => ({ kind: "node", node })),
      models: modelHits.map((model): SearchRow => ({ kind: "model", model })),
    };
    return SEARCH_BLOCK_ORDER[searchTab].map((block) => ({ block, rows: byBlock[block] })).filter((b) => b.rows.length > 0);
  }, [searchActive, searchSections, modelHits, searchTab]);

  const searchRows = useMemo<SearchRow[]>(() => (searchBlocks ? searchBlocks.flatMap((b) => b.rows) : []), [searchBlocks]);


  const categoryNodes = useMemo<NodeOption[]>(() => {
    if (!selectedCategory) return [];
    if (selectedCategory === VIRTUAL_CATEGORY_IDS.recent) {
      return mapHistoryToOptions(history, (a, b) => b.lastUsedAt - a.lastUsedAt, optionByType);
    }
    // Real categories: cluster nodes by group so each section header renders
    // once (the virtual categories above keep their curated/history order).
    return clusterByGroup(effectivePool.filter((node) => node.category === selectedCategory));
  }, [selectedCategory, effectivePool, optionByType, history]);

  // Recent is opt-in per-user (Settings → Add Node Menu). Most Used was
  // removed with the picker redesign — POPULAR covers the same need
  // editorially, and a second history list was never reachable.
  const visibleCategories = useMemo(() => {
    return CATEGORIES.filter((cat) => {
      if (cat.id === VIRTUAL_CATEGORY_IDS.recent) return showRecentNodes;
      return true;
    });
  }, [showRecentNodes]);

  // Family-grouped content for the active tab. Built for Models too — that
  // view keeps the model tree and appends the Generation Settings family
  // underneath it.
  const pickerSections = useMemo(() => {
    const built = sectionsForTab(isFiltered ? effectivePool : browsePool, activeTab);
    // RECENT leads the Common tab when the user has opted in — the per-user
    // counterpart to the editorial POPULAR block. It is derived from history,
    // so it cannot live in the static registry; an empty history renders
    // nothing at all, same as any other empty family.
    if (activeTab !== "common" || !showRecentNodes) return built;
    const recent = mapHistoryToOptions(
      history,
      (a, b) => b.lastUsedAt - a.lastUsedAt,
      optionByType,
    ).slice(0, 6);
    if (!recent.length) return built;
    return {
      ...built,
      sections: [{ id: "common-recent", label: t("nodecat.Recent"), options: recent }, ...built.sections],
    };
  }, [activeTab, effectivePool, browsePool, isFiltered, showRecentNodes, history, optionByType, t]);

  // Generation Settings rows under the model tree. They keep their own cursor
  // because the tree owns the arrows on that tab and hands the index over once
  // it runs off its own end.
  const modelsTrailingRows = useMemo(
    () => (pickerSections ? pickerSections.sections.flatMap((s) => [...s.options]) : []),
    [pickerSections],
  );
  const [modelsTrailingIndex, setModelsTrailingIndex] = useState<number | null>(null);
  useEffect(() => setModelsTrailingIndex(null), [activeTab, searchQuery]);

  // Rows the section list contributes to the flat keyboard order, in render
  // order — including the Creative Controls toggle sentinel.
  const sectionNavItems = useMemo(
    () =>
      pickerSections
        ? flattenSections(pickerSections.sections, pickerSections.controls, creativeControlsOpen)
        : [],
    [pickerSections, creativeControlsOpen],
  );

  // Items to display (search results, compatibility tiers, category nodes,
  // a media tab, the Common tab root, or the All tab's categories)
  const displayItems = useMemo(() => {
    // Search nav is driven by searchRows; displayItems only needs the node slice
    // here for the non-search branches + the scroll-into-view effect.
    if (searchActive) return searchSections ? [...searchSections.own, ...searchSections.other] : [];
    if (isFiltered && !selectedCategory) return effectivePool;
    if (selectedCategory) return categoryNodes;
    if (pickerSections) return sectionNavItems;
    return visibleCategories;
  }, [searchActive, searchSections, isFiltered, selectedCategory, effectivePool, categoryNodes, pickerSections, sectionNavItems, visibleCategories]);

  // Footer count: node rows currently on screen. Model rows, category rows and
  // the Creative Controls toggle are excluded — none of them is a node you can
  // add — and nothing here is a hardcoded catalog total, so the number stays
  // honest as families collapse or an edition hides its Cloud-only nodes.
  const renderedNodeCount = useMemo(
    () =>
      searchActive
        ? searchRows.filter((r) => r.kind === "node").length
        : displayItems.filter((item) => item && "type" in item).length,
    [searchActive, searchRows, displayItems],
  );

  // Reset state when opening/closing
  useEffect(() => {
    if (open) {
      setSearchQuery("");
      setSelectedCategory(initialCategory ?? null);
      // An initialCategory drill-down (e.g. the empty-state's "Input") lives
      // under the All root — display that tab for this open WITHOUT
      // persisting; only explicit tab switches are remembered.
      setActiveTab(initialCategory ? "all" : readAddNodeMenuTab());
      setHighlightedIndex(0);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [open, initialCategory]);

  // Handle click outside
  useClickOutside(popupRef, onClose, open);

  // Handle keyboard navigation
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      // A key another handler already consumed must not be re-processed here.
      // Concretely: the canvas's capture-phase Tab handler preventDefaults the
      // Tab that OPENS this popup — React flushes the open synchronously
      // (discrete event), our listener attaches mid-dispatch, and the same
      // keystroke would otherwise immediately toggle the Common/All mode.
      if (e.defaultPrevented) return;
      if (e.key === "Escape") {
        if (selectedCategory && !searchQuery) {
          // Jump straight back to the active tab's root from any inner menu.
          setSelectedCategory(null);
          setHighlightedIndex(0);
        } else {
          onClose();
        }
        return;
      }

      if (e.key === "Tab") {
        // Tab cycles the mode forward, Shift+Tab backward. In edge-drop
        // compatibility mode the tabs are hidden, so let the browser's
        // default focus move run.
        if (!isFiltered) {
          e.preventDefault();
          switchTab(nextAddNodeMenuTab(activeTab, e.shiftKey ? -1 : 1));
        }
        return;
      }

      // ←/→ cycle tabs while the query is empty — the footer advertises
      // "→ Tabs", so the shortcut has to work. Placed above the Models bail
      // because the model tree only claims ArrowLeft when a series is drilled
      // open (it stops propagation there, and backing out wins over cycling).
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !searchQuery && !isFiltered) {
        e.preventDefault();
        switchTab(nextAddNodeMenuTab(activeTab, e.key === "ArrowRight" ? 1 : -1));
        return;
      }

      // In the Models browse view the model-tree owns Arrow/Enter. Bail before
      // those branches — but AFTER Escape (closes) and Tab (cycles tabs), and
      // only while NOT searching (search is the popup's own unified list).
      if (inModelsView && !searchActive) return;

      // During search the unified node+model rows drive nav; otherwise the
      // category/media/common/all displayItems do.
      const navLen = searchActive ? searchRows.length : displayItems.length;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((prev) => Math.min(prev + 1, navLen - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (searchActive) {
          const row = searchRows[highlightedIndex];
          if (row?.kind === "node") handleNodeSelect(row.node.type);
          else if (row?.kind === "model") handleSelectModel(variantToSelection(row.model));
        } else {
          const item = displayItems[highlightedIndex];
          if (item) {
            if (isCreativeControlsNavItem(item)) {
              toggleCreativeControls();
            } else if ("type" in item) {
              handleNodeSelect(item.type);
            } else {
              // It's a category
              setSelectedCategory(item.id);
              setHighlightedIndex(0);
            }
          }
        }
      } else if (e.key === "Backspace" && !searchQuery && selectedCategory) {
        // Inner menus all sit directly under the tab root, so back == root.
        setSelectedCategory(null);
        setHighlightedIndex(0);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    open,
    displayItems,
    searchRows,
    searchActive,
    inModelsView,
    highlightedIndex,
    selectedCategory,
    searchQuery,
    isFiltered,
    activeTab,
    switchTab,
    onClose,
    handleNodeSelect,
    handleSelectModel,
    toggleCreativeControls,
  ]);

  // Reset highlighted index when items change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [searchQuery, selectedCategory, activeTab]);

  // Keep the keyboard-highlighted item scrolled into view (arrow up/down).
  // `modelsTrailingIndex` is in the deps because the Generation Settings rows
  // under the model tree carry their own cursor — without it those rows are
  // navigable but scroll off-screen, which is the defect the keyboard fix was
  // meant to remove.
  useEffect(() => {
    scrollContainerRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, displayItems, modelsTrailingIndex]);

  if (!open && !componentBrowserOpen) return null;

  // Always centred in the viewport, regardless of the invocation point (Tab,
  // sidebar "+", right-click, edge-drop). Only NODE PLACEMENT uses the
  // invocation `position` — the canvas keeps that in its own state; the
  // `position` prop here is forwarded to the component marketplace modal.
  // Fixed 60% page height: every tab renders the same stable modal — long
  // lists scroll inside, short ones don't shrink it.
  const popupStyle = {
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    height: "60vh",
  };

  return (
    <>
    {open && !componentBrowserOpen && <div
      ref={popupRef}
      className={cn(
        // 790px is the design width — the nine intent tabs need it to fit on
        // one line without the strip having to scroll.
        "fixed z-[100] w-[790px] max-w-[calc(100vw-16px)] flex flex-col",
        "bg-[var(--npk-surface)]",
        "border border-[var(--npk-border)]",
        "rounded-xl shadow-xl",
        "overflow-hidden",
      )}
      style={popupStyle}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--npk-border)]">
        <h3 className="text-base font-semibold text-[var(--npk-t1)]">
          {selectedCategory ? (
            <button
              onClick={() => {
                setSelectedCategory(null);
                searchInputRef.current?.focus();
              }}
              className="flex items-center gap-2 hover:text-[var(--npk-accent)] transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              {nodeCategory(selectedCategory)}
            </button>
          ) : isFiltered && connectionContext ? (
            <div className="flex items-center gap-2">
              <span>{t("addnode.connectTo")}</span>
              {(() => {
                // Tint the chip in the handle's own type color when known
                // (`connectionContext.color` is the pip's `--pip-color`);
                // fall back to the default violet otherwise. `${hex}33` /
                // `${hex}4D` append ~20% / ~30% alpha to the 6-digit hex.
                const c = connectionContext.color
                const style = c
                  ? { color: c, backgroundColor: `${c}33`, borderColor: `${c}4D` }
                  : undefined
                return (
                  <span
                    className={cn(
                      "px-2 py-0.5 rounded-full text-sm font-medium border",
                      !c &&
                        "bg-[var(--npk-chip-fallback-bg)] text-[var(--npk-chip-fallback)] border-[var(--npk-chip-fallback-border)]",
                    )}
                    style={style}
                  >
                    {connectionContext.direction === "source"
                      ? `${connectionContext.handleId} →`
                      : `→ ${connectionContext.handleId}`}
                  </span>
                )
              })()}
            </div>
          ) : autoConnectCtx ? (
            <span className="flex items-center gap-1.5">
              <span>{t("addnode.connectingNewNodeTo")}</span>
              <span className="text-[var(--npk-accent)]">{autoConnectCtx.focusedLabel}</span>
            </span>
          ) : (
            t("addnode.whatCreate")
          )}
        </h3>
      </div>

      {/* Mode tabs — hidden in edge-drop compatibility mode where the list is
          connection-driven, not category-driven. Tab cycles, Shift+Tab reverses. */}
      {!isFiltered && <PickerTabBar activeTab={activeTab} onSelect={switchTab} />}

      {/* Search */}
      <div className="px-3 py-2 border-b border-[var(--npk-border)]">
        <div className="flex items-center gap-2">
          <div className={cn("relative", isFiltered ? "flex-1" : "w-[300px] max-w-full")}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--npk-muted)]" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder={inModelsView ? t("addnode.searchModelsNodes") : t("addnode.searchNodes")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={cn(
                "w-full pl-9 pr-3 py-2 text-base",
                "bg-[var(--npk-footer)]",
                "border border-[var(--npk-border)]",
                "rounded-lg",
                "text-[var(--npk-t1)]",
                "placeholder:text-[var(--npk-muted)]",
                "focus:outline-none focus:border-[var(--npk-accent)] focus:shadow-[var(--npk-focus-glow)]",
              )}
            />
          </div>
          {/* Auto Connect toggle: only meaningful when there's a focused node to
              wire to (Tab on a node sets autoConnectCtx). Hidden when nothing is
              focused (generic Tab / sidebar add) and for edge-drop (which
              direct-wires the dragged handle). The Smart Connect toggle that used
              to sit beside it is intentionally hidden — Smart is force-OFF in
              auto-connect-pref.ts so picking a node always opens the dialog. */}
          {autoConnectCtx && (
            <div className="flex items-center gap-3 shrink-0 ml-auto">
              <ToggleLabel
                icon={<Link2 className="w-3.5 h-3.5 text-[var(--npk-accent)]" />}
                label={t("addnode.autoConnect")}
                checked={autoConnect}
                onChange={(v) => {
                  setAutoConnect(v)
                  setAutoConnectPref(v)
                }}
                ariaLabel={t("addnode.autoConnectAria")}
                title={t("addnode.autoConnectHint")}
              />
            </div>
          )}
        </div>
      </div>

      {/* Content — flex-1 so it fills whatever space remains within the
          fixed-height popup (header + tabs + search above are fixed). Radix
          scroll area (type="auto") keeps the scrollbar visible whenever the
          list overflows, regardless of the OS overlay-scrollbar setting. */}
      <ScrollArea type="auto" className="flex-1 min-h-0">
      <div ref={scrollContainerRef} className="py-2">
        {inModelsView && !searchActive ? (
          // Models browse view (the Models tab or the All-tab "Models"
          // category): series → variants, then the Generation Settings family
          // — the seven config nodes that used to be reachable only by
          // dragging a wire. The model tree owns the arrow keys, so it hands
          // the cursor on to these rows rather than clamping at its own end.
          <>
            <ModelsTab
              onSelectModel={handleSelectModel}
              trailing={
                modelsTrailingRows.length > 0
                  ? {
                      count: modelsTrailingRows.length,
                      highlighted: modelsTrailingIndex,
                      onHighlight: setModelsTrailingIndex,
                      onEnter: (i) => {
                        const node = modelsTrailingRows[i];
                        if (node) handleNodeSelect(node.type);
                      },
                    }
                  : undefined
              }
            />
            {pickerSections.sections.length > 0 && (
              <PickerSectionList
                sections={pickerSections.sections}
                controls={[]}
                controlsOpen={false}
                onToggleControls={toggleCreativeControls}
                highlightedIndex={modelsTrailingIndex ?? -1}
                onHover={setModelsTrailingIndex}
                onSelect={handleNodeSelect}
              />
            )}
          </>
        ) : searchActive ? (
          // Search: current-tab hits under their family headers, then a
          // labelled separator and the cross-tab hits, each badged with the
          // tab it lives on. Model hits slot in per SEARCH_BLOCK_ORDER. One
          // running nav index across every row so keyboard highlight/Enter
          // line up with what is drawn.
          searchBlocks && searchBlocks.length > 0 ? (
            (() => {
              let nav = 0;
              return searchBlocks.map(({ block, rows }) => {
                const at = nav;
                nav += rows.length;
                if (block === "models") {
                  return (
                    <div key={block} className="mb-2.5">
                      <div className="sticky top-0 z-10 bg-[var(--npk-surface)] px-2.5 pb-1.5 pt-2 text-[10.5px] font-semibold uppercase tracking-[1.3px] text-[var(--npk-dim)]">
                        {t(SEARCH_BLOCK_HEADER[block])}
                      </div>
                      {rows.map((r, i) =>
                        r.kind === "model" ? (
                          <VariantRow
                            key={`m-${r.model.id}`}
                            v={r.model}
                            active={at + i === highlightedIndex}
                            onHover={() => setHighlightedIndex(at + i)}
                            onPick={(v) => handleSelectModel(variantToSelection(v))}
                          />
                        ) : null,
                      )}
                    </div>
                  );
                }
                const hits = rows.flatMap((r) => (r.kind === "node" ? [r.node] : []));
                const badge = (node: NodeOption) =>
                  directMatchTypes.has(node.type) ? matchLabel : undefined;
                return block === "nodeOwn" ? (
                  <SearchOwnBlock
                    key={block}
                    hits={hits}
                    startIndex={at}
                    highlightedIndex={highlightedIndex}
                    onHover={setHighlightedIndex}
                    onSelect={handleNodeSelect}
                    badgeFor={badge}
                  />
                ) : (
                  <SearchOtherBlock
                    key={block}
                    hits={hits}
                    startIndex={at}
                    highlightedIndex={highlightedIndex}
                    onHover={setHighlightedIndex}
                    onSelect={handleNodeSelect}
                    directBadge={badge}
                  />
                );
              });
            })()
          ) : (
            <SearchEmptyState query={searchQuery.trim()} />
          )

        ) : isFiltered && compatibilityNodes && !selectedCategory ? (
          // Smart edge-drop: show direct matches then compatible
          <>
            {compatibilityNodes.direct.length > 0 && (
              <>
                <div className="text-[12px] uppercase tracking-wider text-[var(--npk-match-dim)] font-medium px-4 pt-2 pb-1 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--npk-match)]" />
                  {t("addnode.directMatch")}
                </div>
                {compatibilityNodes.direct.map((node, index) => (
                  <button
                    key={node.type}
                    type="button"
                    onClick={() => handleNodeSelect(node.type)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                      index === highlightedIndex
                        ? "bg-[var(--npk-sel-bg)]"
                        : "hover:bg-[var(--npk-hover)]",
                    )}
                    onMouseEnter={() => setHighlightedIndex(index)}
                data-active={index === highlightedIndex ? "true" : undefined}
                  >
                    <span className="text-[var(--npk-icon)]">
                      {node.icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-base font-medium text-[var(--npk-t1)] truncate">{localizeNode(node.label)}</div>
                      <div className="text-sm text-[var(--npk-muted)]">{nodeCategory(node.category)}</div>
                    </div>
                    <MatchBadge label={matchLabel} />
                  </button>
                ))}
              </>
            )}
            {compatibilityNodes.compatible.length > 0 && (
              <>
                <div className="text-[12px] uppercase tracking-wider text-muted-foreground/60 font-medium px-4 pt-2 pb-1">
                  {t("addnode.compatible")}
                </div>
                {compatibilityNodes.compatible.map((node, rawIndex) => {
                  const index = compatibilityNodes.direct.length + rawIndex;
                  return (
                    <button
                      key={node.type}
                      type="button"
                      onClick={() => handleNodeSelect(node.type)}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                        index === highlightedIndex
                          ? "bg-[var(--npk-sel-bg)]"
                          : "hover:bg-[var(--npk-hover)]",
                      )}
                      onMouseEnter={() => setHighlightedIndex(index)}
                data-active={index === highlightedIndex ? "true" : undefined}
                    >
                      <span className="text-[var(--npk-icon)]">
                        {node.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-base font-medium text-[var(--npk-t2)] truncate">{localizeNode(node.label)}</div>
                        <div className="text-sm text-[var(--npk-muted)]">{nodeCategory(node.category)}</div>
                      </div>
                    </button>
                  );
                })}
              </>
            )}
          </>
        ) : selectedCategory ? (
          categoryNodes.length === 0 ? (
            <div className="px-4 py-8 text-center text-base text-[var(--npk-muted)]">
              {t("addnode.noNodesYet")}
            </div>
          ) : (
          // Category nodes — with optional group sub-headers
          (categoryNodes as NodeOption[]).map((node, index, arr) => {
            const prevGroup =
              index > 0 ? arr[index - 1].group : undefined;
            const showGroupHeader =
              node.group && node.group !== prevGroup;
            return (
              <div key={node.type}>
                {showGroupHeader && (
                  <>
                    {index > 0 && (
                      <div className="border-t border-muted-foreground/10 mx-3 mt-1" />
                    )}
                    <div className="text-[12px] uppercase tracking-wider text-muted-foreground/60 font-medium px-4 pt-2 pb-1">
                      {(() => {
                        const label = familyLabel(node.group)
                        return label ? localizeGroup(label) : label
                      })()}
                    </div>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => handleNodeSelect(node.type)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-2.5 text-left",
                    "transition-colors",
                    index === highlightedIndex
                      ? "bg-[var(--npk-sel-bg)]"
                      : "hover:bg-[var(--npk-hover)]",
                  )}
                  onMouseEnter={() => setHighlightedIndex(index)}
                data-active={index === highlightedIndex ? "true" : undefined}
                >
                  <span
                    className={cn(
                      "text-[var(--npk-icon)]",
                    )}
                  >
                    {node.icon}
                  </span>
                  <span className="text-base text-[var(--npk-t1)]">
                    {localizeNode(node.label)}
                  </span>
                  {directMatchTypes.has(node.type) && (
                    <MatchBadge label={matchLabel} className="ml-auto" />
                  )}
                </button>
              </div>
            );
          })
          )
        ) : pickerSections ? (
          // Family-grouped tab body: POPULAR (media tabs), then the families
          // this tab shows, then the collapsed Creative Controls block. Nav
          // order mirrors sectionNavItems, so highlight and Enter line up
          // with what is drawn.
          pickerSections.sections.length === 0 && pickerSections.controls.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13.5px] text-[var(--npk-muted)]">
              {t("addnode.noNodesEdition")}
            </div>
          ) : (
            <PickerSectionList
              sections={pickerSections.sections}
              controls={pickerSections.controls}
              controlsOpen={creativeControlsOpen}
              onToggleControls={toggleCreativeControls}
              highlightedIndex={highlightedIndex}
              onHover={setHighlightedIndex}
              onSelect={handleNodeSelect}
              badgeFor={(node) => (directMatchTypes.has(node.type) ? matchLabel : undefined)}
            />
          )
        ) : (
          // Categories (All tab)
          visibleCategories.map((cat, index) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => {
                setSelectedCategory(cat.id);
                setHighlightedIndex(0);
                searchInputRef.current?.focus();
              }}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 text-left",
                "transition-colors",
                index === highlightedIndex
                  ? "bg-[var(--npk-sel-bg)]"
                  : "hover:bg-[var(--npk-hover)]",
              )}
              onMouseEnter={() => setHighlightedIndex(index)}
                data-active={index === highlightedIndex ? "true" : undefined}
            >
              <span
                className={cn(
                  "text-[var(--npk-icon)]",
                )}
              >
                {cat.icon}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold uppercase tracking-wider text-[var(--npk-t1)]">
                  {t(cat.labelKey)}
                </div>
                <div className="text-sm text-[var(--npk-muted)]">{t(cat.descKey)}</div>
              </div>
              <ChevronRight className="w-4 h-4 text-[var(--npk-muted)]" />
            </button>
          ))
        )}
      </div>
      </ScrollArea>

      {/* Footer hint */}
      <div className="px-4 py-2 border-t border-[var(--npk-border)] bg-[var(--npk-footer)]">
        <div className="flex items-center gap-4 text-[12px] text-[var(--npk-muted)]">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-[var(--npk-key)] rounded border border-[var(--npk-border)]">
              ↑↓
            </kbd>
            {t("addnode.navigate")}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-[var(--npk-key)] rounded border border-[var(--npk-border)]">
              ↵
            </kbd>
            {t("addnode.select")}
          </span>
          {!isFiltered && (
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-[var(--npk-key)] rounded border border-[var(--npk-border)]">
                ⇥
              </kbd>
              {t("addnode.tabs")}
            </span>
          )}
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-[var(--npk-key)] rounded border border-[var(--npk-border)]">
              Esc
            </kbd>
            {t("addnode.close")}
          </span>
          {/* Count of what is actually on screen right now — derived, never a
              hardcoded catalog total, so it stays honest as families collapse
              or the edition hides Cloud-only nodes. */}
          <span className="ml-auto tabular-nums text-[var(--npk-faint)]">
            {renderedNodeCount} {renderedNodeCount === 1 ? t("addnode.unitNode") : t("addnode.unitNodes")}
          </span>
        </div>
      </div>
    </div>}

    {/* Component Marketplace Modal */}
    {componentBrowserOpen && (
      <Suspense fallback={null}>
        <ComponentMarketplaceModal
          open={componentBrowserOpen}
          onOpenChange={setComponentBrowserOpen}
          onSelect={handleComponentSelect}
          position={position}
        />
      </Suspense>
    )}
    </>
  );
}
