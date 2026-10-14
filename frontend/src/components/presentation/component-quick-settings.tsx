import type { ExposedSetting } from "@nodaro/shared/apps"
import {
  getQuickConfigs,
  readQuickConfigValue,
  resolveQuickConfigOptions,
  type QuickConfigControl,
} from "@/components/nodes/node-quick-configs"
import { exposedOptionValue, type ResolvedExposableField } from "./exposable-fields"
import { patchAsRunValues } from "./helpers"
import { QuickFieldCard } from "./quick-field-card"

type Primitive = string | number | boolean
const isPrimitive = (v: unknown): v is Primitive => typeof v === "string" || typeof v === "number" || typeof v === "boolean"

/**
 * The node's lever values a quick control's options (or its read projection) depend on: every key the control
 * reads while listing its options, plus the node's other quick-control fields (a lever a sibling setting may
 * change, e.g. the model). Primitive values only — a prompt or a result never travels with a component.
 */
export function quickFieldContext(
  nodeType: string,
  control: QuickConfigControl,
  data: Record<string, unknown>,
): Record<string, Primitive> {
  const reads = new Set<string>()
  const proxy = new Proxy(data, {
    get(target, prop) {
      if (typeof prop === "string") reads.add(prop)
      return Reflect.get(target, prop)
    },
    has(target, prop) {
      if (typeof prop === "string") reads.add(prop)
      return Reflect.has(target, prop)
    },
  })
  resolveQuickConfigOptions(control, proxy)
  readQuickConfigValue(control, proxy)
  for (const sibling of getQuickConfigs(nodeType)) reads.add(sibling.field)
  const out: Record<string, Primitive> = {}
  for (const key of [...reads].sort()) {
    if (key === control.field) continue
    const v = data[key]
    if (isPrimitive(v)) out[key] = v
  }
  return out
}

/**
 * The ExposedSetting a component publishes for a strip-derived field. Its options (and typed allowed values) are
 * the strip's when they are the same for every model; otherwise the consuming card computes them, from `quick`.
 * An unset field publishes the value the node runs as.
 */
export function quickExposedSetting(
  field: ResolvedExposableField,
  node: { id: string; type: string; data?: Record<string, unknown> },
  label: string,
): ExposedSetting {
  const control = field.quick!
  const data = (node.data ?? {}) as Record<string, unknown>
  const nodeType = node.type
  const saved = data[field.key]
  return {
    nodeId: node.id,
    field: field.key,
    label,
    type: "select",
    ...(field.options
      ? {
          options: field.options.map((o) => ({ value: o.value, label: o.label })),
          allowedValues: field.options.map((o) => exposedOptionValue(field, o.value)),
        }
      : {}),
    defaultValue: saved !== undefined ? saved : field.defaultValue,
    quick: { nodeType, context: quickFieldContext(nodeType, control, data) },
  }
}

/** The quick control a published quick setting stands for, if this editor still offers it. */
export function quickSettingControl(setting: ExposedSetting): QuickConfigControl | undefined {
  if (!setting.quick) return undefined
  return getQuickConfigs(setting.quick.nodeType).find((c) => c.field === setting.field && c.exposable !== false && !c.needsGraph)
}

/**
 * The consuming workflow's card for a component's quick setting: the app card (QuickFieldCard) over the
 * component's published lever values with this workflow's choices on top, so it offers what the component's
 * chosen model takes and snaps a value that model cannot take. A choice writes every published setting it
 * touches (a cleared one as null, which the run reads as "unset"); a lever the component did not publish is
 * left to the component's own saved value.
 */
export function ComponentQuickSetting({
  setting,
  settings,
  values,
  onChange,
}: {
  readonly setting: ExposedSetting
  readonly settings: ReadonlyArray<ExposedSetting>
  /** The consuming node's stored setting values, keyed "nodeId:field". */
  readonly values: Readonly<Record<string, unknown>>
  readonly onChange: (changes: Record<string, unknown>) => void
}) {
  const control = quickSettingControl(setting)
  if (!control) return null
  const valueOf = (s: ExposedSetting): unknown => {
    const key = `${s.nodeId}:${s.field}`
    return Object.hasOwn(values, key) && values[key] !== undefined ? values[key] : s.defaultValue
  }
  const nodeData: Record<string, unknown> = { ...(setting.quick?.context ?? {}) }
  for (const s of settings) if (s.nodeId === setting.nodeId) nodeData[s.field] = valueOf(s)
  const published = new Set(settings.filter((s) => s.nodeId === setting.nodeId).map((s) => s.field))
  return (
    <QuickFieldCard
      control={control}
      nodeData={nodeData}
      allowedValues={setting.options ? (setting.allowedValues as Array<string | number | boolean> | undefined) : undefined}
      customLabel={setting.label}
      onPatch={(patch) => {
        const changes: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(patchAsRunValues(patch))) {
          if (published.has(k)) changes[`${setting.nodeId}:${k}`] = v
        }
        if (Object.keys(changes).length > 0) onChange(changes)
      }}
    />
  )
}
