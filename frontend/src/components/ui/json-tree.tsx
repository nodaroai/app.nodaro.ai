"use client"

/**
 * Collapsible tree over a JSON value.
 *
 * Built for node results that are STRUCTURED rather than a single string: a flat
 * preview of one array (the old video-analysis scene list) hides everything else
 * the payload carries, and raw pretty-printed JSON is unreadable at node scale.
 *
 * Containers are closed past `defaultExpandedDepth`, so the initial render is a
 * scannable index the user drills into. `labelFor` is the only domain hook — it
 * turns `scenes[7]` into `#8 · 8.6–9.5s · first european speech` without this
 * component knowing anything about the schema it is rendering.
 */

import { memo, useCallback, useMemo, useState } from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
export type JsonPath = readonly (string | number)[]

/** One-line summary for a container row, in place of its bare key/index. */
export type JsonNodeLabeler = (path: JsonPath, value: JsonValue) => string | undefined

const isContainer = (v: JsonValue): v is JsonValue[] | { [key: string]: JsonValue } =>
  v !== null && typeof v === "object"

/** Object key order is the payload's own — never re-sorted, so the tree mirrors the JSON. */
const entriesOf = (v: JsonValue[] | { [key: string]: JsonValue }): Array<[string | number, JsonValue]> =>
  Array.isArray(v) ? v.map((child, i) => [i, child]) : Object.entries(v)

function Leaf({ value }: { readonly value: JsonValue }) {
  if (typeof value === "string") {
    // Wraps rather than truncates: a description IS the result, so a long value
    // costs height inside the scroll container, never content.
    return <span className="text-foreground/90 whitespace-pre-wrap break-words">{value}</span>
  }
  if (typeof value === "number") return <span className="text-sky-500 tabular-nums">{value}</span>
  if (typeof value === "boolean") return <span className="text-violet-400">{String(value)}</span>
  return <span className="text-muted-foreground/50 italic">null</span>
}

function Row({
  nodeKey, value, path, depth, labelFor, isOpen, onToggle,
}: {
  readonly nodeKey: string | number
  readonly value: JsonValue
  readonly path: JsonPath
  readonly depth: number
  readonly labelFor?: JsonNodeLabeler
  readonly isOpen: (path: JsonPath, depth: number) => boolean
  readonly onToggle: (path: JsonPath, next: boolean) => void
}) {
  const label = labelFor?.(path, value)
  const keyText = label ?? (typeof nodeKey === "number" ? `[${nodeKey}]` : nodeKey)

  if (!isContainer(value)) {
    return (
      <div className="flex items-baseline gap-1.5 py-px" style={{ paddingLeft: depth * 10 }}>
        <span className="text-muted-foreground shrink-0">{keyText}</span>
        <Leaf value={value} />
      </div>
    )
  }

  const entries = entriesOf(value)
  const open = isOpen(path, depth)
  const count = Array.isArray(value) ? entries.length : undefined

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        className="flex items-baseline gap-1 w-full text-start hover:bg-muted/50 rounded-sm py-px"
        style={{ paddingLeft: depth * 10 }}
        onClick={(e) => { e.stopPropagation(); onToggle(path, !open) }}
      >
        <ChevronRight
          className={cn("w-3 h-3 shrink-0 mt-[3px] text-muted-foreground/60 transition-transform", open && "rotate-90")}
        />
        <span className={cn("min-w-0 break-words", label ? "text-foreground/90" : "font-medium text-muted-foreground")}>
          {keyText}
        </span>
        {count !== undefined && <span className="text-muted-foreground/50 tabular-nums shrink-0">({count})</span>}
      </button>
      {open && entries.map(([childKey, child]) => (
        <Row
          key={childKey}
          nodeKey={childKey}
          value={child}
          path={[...path, childKey]}
          depth={depth + 1}
          labelFor={labelFor}
          isOpen={isOpen}
          onToggle={onToggle}
        />
      ))}
    </div>
  )
}

function JsonTreeComponent({
  value, labelFor, defaultExpandedDepth = 1, className,
}: {
  readonly value: JsonValue
  readonly labelFor?: JsonNodeLabeler
  /**
   * Containers at a depth < this start open; the root object's own children are
   * depth 0. The default of 1 opens the top-level groups and leaves their items
   * closed — `scenes (43)` listing 43 one-line summaries, not 43 open records.
   */
  readonly defaultExpandedDepth?: number
  readonly className?: string
}) {
  // Sparse OVERRIDES rather than a full expansion set: the default follows depth,
  // so a 40-scene payload holds no per-node state until something is clicked.
  // Path keys join on NUL — a delimiter no JSON key can contain, so two distinct
  // paths can never collapse onto one expansion entry.
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(() => new Map())

  const isOpen = useCallback(
    (path: JsonPath, depth: number) => overrides.get(path.join("\u0000")) ?? depth < defaultExpandedDepth,
    [overrides, defaultExpandedDepth],
  )
  const onToggle = useCallback((path: JsonPath, next: boolean) => {
    setOverrides((prev) => new Map(prev).set(path.join("\u0000"), next))
  }, [])

  const entries = useMemo(() => (isContainer(value) ? entriesOf(value) : []), [value])
  if (!isContainer(value)) return <div className={className}><Leaf value={value} /></div>

  return (
    <div className={cn("font-mono text-[10px] leading-relaxed", className)}>
      {entries.map(([key, child]) => (
        <Row
          key={key}
          nodeKey={key}
          value={child}
          path={[key]}
          depth={0}
          labelFor={labelFor}
          isOpen={isOpen}
          onToggle={onToggle}
        />
      ))}
    </div>
  )
}

export const JsonTree = memo(JsonTreeComponent)
