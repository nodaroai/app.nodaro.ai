import { useState } from "react"
import { Check, Copy, X } from "lucide-react"
import { useT } from "@/lib/i18n"
import {
  inspectorFields,
  inspectorSettings,
  wiredInputFields,
  type InspectorEdge,
  type InspectorField,
  type InspectorNode,
  type InspectorSetting,
} from "./node-inspector-fields"

const COPIED_MS = 1500

function nodeTitle(node: InspectorNode): string {
  const { label, title } = node.data
  if (typeof label === "string" && label.trim()) return label
  if (typeof title === "string" && title.trim()) return title
  return node.type ?? node.id
}

function FieldBlock({ field }: { readonly field: InspectorField }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(field.value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), COPIED_MS)
    } catch {
      // No clipboard (insecure context, denied permission): the text below
      // stays selectable, which is the fallback the reader already has.
    }
  }
  return (
    <section className="mb-3 last:mb-0">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[1.2px] text-[var(--home-muted)]">
          {field.source ? t("templates.inspector.receivedFrom", { label: field.label, source: field.source }) : field.label}
        </span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-[var(--home-muted)] transition-colors hover:bg-[var(--home-raised)] hover:text-[var(--home-fg)]"
        >
          {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
          {copied ? t("templates.inspector.copied") : t("templates.inspector.copy")}
        </button>
      </div>
      <p className="select-text whitespace-pre-wrap break-words rounded-lg bg-[var(--home-raised)] px-3 py-2 leading-relaxed text-[var(--home-fg)]">{field.value}</p>
    </section>
  )
}

function InspectorHeader({ title, type, onClose }: { readonly title: string; readonly type?: string; readonly onClose: () => void }) {
  const t = useT()
  return (
    <header className="flex items-start justify-between gap-3 border-b border-[var(--home-line)] px-4 py-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-bold text-[var(--home-strong)]">{title}</div>
        <div className="text-[11px] text-[var(--home-muted)]">{type}</div>
      </div>
      <button
        type="button"
        aria-label={t("templates.inspector.close")}
        onClick={onClose}
        className="grid size-7 flex-none place-items-center rounded-md text-[var(--home-muted)] transition-colors hover:bg-[var(--home-raised)] hover:text-[var(--home-fg)]"
      >
        <X className="size-4" aria-hidden />
      </button>
    </header>
  )
}

/** The short settings as chips ("Model · gpt-image-2"). */
function SettingChips({ settings }: { readonly settings: readonly InspectorSetting[] }) {
  if (settings.length === 0) return null
  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {settings.map((s) => (
        <span key={s.label} className="rounded-md bg-[var(--home-raised)] px-2 py-0.5 text-[11px] text-[var(--home-fg-2)]">
          <span className="text-[var(--home-muted)]">{s.label} · </span>
          {s.value}
        </span>
      ))}
    </div>
  )
}

/**
 * The read-only canvas's answer to "I can see the node but not its prompt":
 * a panel with every long text field of one node in full — prompt, negative
 * prompt, system and user prompts, a note's body, a generated result — plus
 * the short settings as chips. What the node RECEIVED on a wire comes first
 * (`wiredInputFields`): an image or video prompted by a selector stores no
 * prompt of its own. Reading and copying only; nothing here can touch the
 * template.
 */
export function NodeInspector({
  node,
  nodes,
  edges,
  onClose,
}: {
  readonly node: InspectorNode
  readonly nodes: readonly InspectorNode[]
  readonly edges: readonly InspectorEdge[]
  readonly onClose: () => void
}) {
  const t = useT()
  const title = nodeTitle(node)
  const fields = [...wiredInputFields(node, nodes, edges), ...inspectorFields(node)]
  return (
    <aside
      role="dialog"
      aria-label={title}
      className="absolute bottom-[18px] start-[18px] top-[64px] z-10 flex w-[380px] max-w-[calc(100%-36px)] flex-col overflow-hidden rounded-[14px] border border-[var(--home-line)] bg-[var(--home-panel)] text-[13px] text-[var(--home-fg)] shadow-xl"
    >
      <InspectorHeader title={title} type={node.type} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <SettingChips settings={inspectorSettings(node)} />
        {fields.length === 0 && <p className="text-[var(--home-muted)]">{t("templates.inspector.empty")}</p>}
        {fields.map((f) => (
          <FieldBlock key={f.key} field={f} />
        ))}
      </div>
    </aside>
  )
}
