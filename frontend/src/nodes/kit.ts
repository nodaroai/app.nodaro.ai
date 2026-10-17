// frontend/src/nodes/kit.ts — the node-unit kit of the editor (§5.8 B, decided
// 2026-10-16; tools/units/README.md). TYPE-ONLY: every import below is
// `import type` and this module declares no value, so a unit that imports it
// adds no run-time edge — it can never join the editor's import cycle
// (execute-node.ts, use-workflow-store.ts), which C1 and G5 forbid.
//
// What a unit file exports, by file:
//   definition.generated.ts → `definition: UnitDefinition` (generated from unit.json)
//   node.tsx                → `NodeComponent: UnitNodeComponent` (its store access: `UnitNodeKit`)
//   config.tsx              → `ConfigPanel: UnitConfigPanel`       (exec-kit.ts)
//   option.tsx              → `option: UnitOption`
//   exec.ts                 → `executor: UnitExecutor`             (exec-kit.ts)
//   labels.generated.ts     → `labels: UnitLabels` (generated from strings.json)
// The aggregates (frontend/src/nodes/_generated/) are typed with these, so a
// unit whose export does not fit fails typecheck at its aggregate line.
//
// This file holds what the DEFINITION side needs and imports only light
// modules: types/nodes.ts reaches it through the definitions aggregate, and
// static import walks that count type imports too (the /embed/scene3d
// isolation guard) must not be led from there into the engine. The run-time
// kit of exec.ts / config.tsx is ./exec-kit.ts.
import type { ComponentType } from "react"
import type { NodeProps } from "@xyflow/react"
import type { HandleColorType } from "@/lib/handle-colors"
import type { NodeCategory } from "@/types/nodes"

/** What a handle carries — the keys of HANDLE_COLORS (tools/units/vocabulary.mjs HANDLE_KINDS). */
export type UnitHandleKind = HandleColorType

export interface UnitInputHandle {
  readonly id: string
  readonly label: string
  /** The kinds of source this input takes. */
  readonly accepts: ReadonlyArray<UnitHandleKind>
  /** The node-data field a wired value lands in. */
  readonly field?: string
}

export interface UnitOutputHandle {
  readonly id: string
  readonly label: string
  readonly kind: UnitHandleKind
  /** The node-data field that holds this output (declarative output extraction). */
  readonly from?: string
}

export type UnitExecutionKind = "source" | "inline" | "sync" | "worker"

export interface UnitRequiredMedia {
  readonly anyOf: ReadonlyArray<string>
  readonly kind: UnitHandleKind
  readonly noun: string
}

/** frontend/src/nodes/<type>/definition.generated.ts — the editor's projection of unit.json. */
export interface UnitDefinition {
  readonly type: string
  readonly label: string
  readonly category: NodeCategory
  readonly inputs: ReadonlyArray<string>
  readonly outputs: ReadonlyArray<string>
  readonly defaultData: Readonly<Record<string, unknown>>
  /** Where the unit sits in NODE_DEFINITIONS order: right after this type (null = first). */
  readonly position: { readonly after: string | null }
  /** The add-node picker entry, or null when the node is not offered there. */
  readonly picker: {
    readonly family: string
    /** The type it follows in its family and in NODE_OPTIONS (null = first). */
    readonly after: string | null
    readonly pickerCategory?: string
    readonly keywords?: ReadonlyArray<string>
  } | null
  readonly handles: { readonly inputs: ReadonlyArray<UnitInputHandle>; readonly outputs: ReadonlyArray<UnitOutputHandle> }
  readonly execution: { readonly kind: UnitExecutionKind; readonly queue?: string; readonly requires?: UnitRequiredMedia }
  /** Memberships central seams read (tools/units/capabilities.mjs). */
  readonly capabilities: ReadonlyArray<string>
  readonly docs: { readonly page?: string; readonly awaiting?: string; readonly useCase?: string }
  /** The editor's price mirror before the server answers — projected from price.ee.ts, never hand-written. */
  readonly priceFallback: number | null
}

/** node.tsx — the canvas component. */
export type UnitNodeComponent = ComponentType<NodeProps>

/**
 * The editor services a node.tsx reaches, bound to its node — given by
 * `useUnitNodeKit(id)` (components/nodes/use-unit-node-kit.ts), which reads the
 * workflow store so the unit never imports it (G5: the store sits in the
 * editor's import cycle).
 */
export interface UnitNodeKit {
  /** The node's config panel is the one open. */
  readonly isSettingsOpen: boolean
  readonly videoAutoplay: boolean
  updateNodeData(patch: Record<string, unknown>): void
  /** Run this node alone (the Run button). */
  run(): void
  /** Open its config panel, or close it when it is the one open. */
  toggleSettings(): void
  /** Open a video result in the FreeCut editor. */
  openFreeCut(videoUrl: string, freecutProjectUrl?: string): void
}

/** option.tsx — what the picker entry needs beyond unit.json: its icon. */
export interface UnitOption {
  readonly icon: ComponentType<{ readonly className?: string }>
}

/** The label locales of strings.json (tools/units/vocabulary.mjs LABEL_LOCALES); "pt-br" is LocaleId "pt-BR". */
export type UnitLabelLocale = "he" | "ja" | "ko" | "pt-br"

/** labels.generated.ts — node-label translations: English label → locale → text. */
export type UnitLabels = Readonly<Record<string, Readonly<Partial<Record<UnitLabelLocale, string>>>>>
