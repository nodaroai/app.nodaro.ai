"use client"

import { useEffect, useRef, useMemo } from "react"
import { useEditor, EditorContent } from "@tiptap/react"
import { Document } from "@tiptap/extension-document"
import { Paragraph } from "@tiptap/extension-paragraph"
import { Text } from "@tiptap/extension-text"
import { HardBreak } from "@tiptap/extension-hard-break"
import { Placeholder, UndoRedo } from "@tiptap/extensions"
import { createRoot, type Root } from "react-dom/client"
import { ImageRefExtension } from "./image-ref-extension"
import { SuggestionList, type SuggestionListHandle } from "./suggestion-list"
import { VariableSuggestionExtension } from "./variable-suggestion-extension"
import { VariableSuggestionList, type VariableSuggestionListHandle } from "./variable-suggestion-list"
import type { RefImageItem } from "../tag-textarea"
import type { NodeRefItem } from "@/lib/node-refs"

const IMAGE_TOKEN_RE = /\{image:(\d+)(?::([a-zA-Z0-9_-]+))?\}/gi

interface PromptEditorProps {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly placeholder?: string
  readonly rows?: number
  readonly className?: string
  readonly referenceImages?: readonly RefImageItem[]
  /** Upstream node references for the `{` typeahead. */
  readonly nodeRefs?: readonly NodeRefItem[]
}

interface JsonNode {
  type: string
  attrs?: Record<string, unknown>
  content?: JsonNode[]
  text?: string
}

/**
 * Convert the canonical value string into a ProseMirror JSON doc. Splits on
 * "\n" for paragraphs and replaces every `{image:N:label}` match with an
 * atomic ImageRef node. Empty paragraphs are preserved so blank lines round
 * trip cleanly.
 */
function valueToDoc(value: string): JsonNode {
  const lines = value.split("\n")
  const paragraphs: JsonNode[] = lines.map((line) => {
    const content: JsonNode[] = []
    let lastIndex = 0
    for (const match of line.matchAll(IMAGE_TOKEN_RE)) {
      const start = match.index ?? 0
      if (start > lastIndex) {
        content.push({ type: "text", text: line.slice(lastIndex, start) })
      }
      content.push({
        type: "imageRef",
        attrs: {
          imageIndex: parseInt(match[1], 10),
          label: match[2] ?? "",
        },
      })
      lastIndex = start + match[0].length
    }
    if (lastIndex < line.length) {
      content.push({ type: "text", text: line.slice(lastIndex) })
    }
    return { type: "paragraph", content: content.length > 0 ? content : undefined }
  })
  return { type: "doc", content: paragraphs }
}

export function PromptEditor({
  value,
  onChange,
  placeholder,
  rows,
  className,
  referenceImages,
  nodeRefs,
}: PromptEditorProps) {
  // Hold the latest reference list in a ref so the suggestion plugin's items()
  // closure (created once at editor mount) always sees fresh data.
  const refsRef = useRef<readonly RefImageItem[]>(referenceImages ?? [])
  refsRef.current = referenceImages ?? []
  const nodeRefsRef = useRef<readonly NodeRefItem[]>(nodeRefs ?? [])
  nodeRefsRef.current = nodeRefs ?? []

  // Hold the latest onChange so we can call it without recreating the editor.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  // Track whether a programmatic content sync is in progress, so the editor's
  // onUpdate doesn't bounce that change back to the parent.
  const applyingExternalRef = useRef(false)

  const editor = useEditor({
    extensions: useMemo(() => [
      Document,
      Paragraph,
      Text,
      HardBreak,
      UndoRedo,
      Placeholder.configure({ placeholder: placeholder ?? "" }),
      ImageRefExtension.configure({
        suggestion: {
          char: "@",
          items: ({ query }) => {
            const all = refsRef.current
            if (!query) return all.slice(0, 20)
            const q = query.toLowerCase()
            return all
              .filter(
                (r) =>
                  r.label.toLowerCase().includes(q) ||
                  String(r.index).includes(q) ||
                  r.defaultLabel.toLowerCase().includes(q),
              )
              .slice(0, 20)
          },
          command: ({ editor: ed, range, props }) => {
            const item = props as unknown as RefImageItem
            ed
              .chain()
              .focus()
              .insertContentAt(range, [
                {
                  type: "imageRef",
                  attrs: { imageIndex: item.index, label: item.defaultLabel },
                },
                { type: "text", text: " " },
              ])
              .run()
          },
          render: () => {
            let mount: HTMLDivElement | null = null
            let root: Root | null = null
            let listRef: SuggestionListHandle | null = null

            const positionMount = (rect: DOMRect | null | undefined) => {
              if (!mount || !rect) return
              const MARGIN = 4
              const vh = window.innerHeight
              const vw = window.innerWidth
              const ESTIMATED_H = 220
              const ESTIMATED_W = 280
              const spaceBelow = vh - rect.bottom - MARGIN
              const placeBelow = spaceBelow >= 160 || spaceBelow >= rect.top
              const top = placeBelow
                ? rect.bottom + MARGIN
                : Math.max(MARGIN, rect.top - ESTIMATED_H - MARGIN)
              const left = Math.min(
                Math.max(MARGIN, rect.left),
                vw - ESTIMATED_W - MARGIN,
              )
              mount.style.top = `${top}px`
              mount.style.left = `${left}px`
            }

            const renderList = (props: {
              items: readonly RefImageItem[]
              command: (item: RefImageItem) => void
              clientRect?: (() => DOMRect | null) | null
            }) => {
              if (!root) return
              positionMount(props.clientRect?.() ?? null)
              root.render(
                <SuggestionList
                  ref={(r) => { listRef = r }}
                  items={props.items}
                  command={props.command}
                />,
              )
            }

            return {
              onStart: (props) => {
                mount = document.createElement("div")
                mount.style.position = "fixed"
                mount.style.zIndex = "9999"
                document.body.appendChild(mount)
                root = createRoot(mount)
                renderList(props as never)
              },
              onUpdate: (props) => renderList(props as never),
              onKeyDown: (props) => listRef?.onKeyDown(props.event) ?? false,
              onExit: () => {
                if (root) {
                  // Defer to avoid React's "unmount during render" warning.
                  const r = root
                  root = null
                  setTimeout(() => r.unmount(), 0)
                }
                if (mount) {
                  const m = mount
                  mount = null
                  setTimeout(() => m.remove(), 0)
                }
                listRef = null
              },
            }
          },
        },
      }),
      VariableSuggestionExtension.configure({
        suggestion: {
          char: "{",
          items: ({ query }: { query: string }) => {
            const all = nodeRefsRef.current
            if (!query) return all.slice(0, 30)
            const q = query.toLowerCase()
            return all
              .filter((r) => r.label.toLowerCase().includes(q) || r.type.toLowerCase().includes(q))
              .slice(0, 30)
          },
          command: ({ editor: ed, range, props }: { editor: typeof editor; range: { from: number; to: number }; props: NodeRefItem }) => {
            // Insert literal text `{Label}` followed by a space — variables stay
            // as plain text in the editor; the runtime resolves them.
            ed
              ?.chain()
              .focus()
              .insertContentAt(range, `{${props.label}} `)
              .run()
          },
          render: () => {
            let mount: HTMLDivElement | null = null
            let root: Root | null = null
            let listRef: VariableSuggestionListHandle | null = null

            const positionMount = (rect: DOMRect | null | undefined) => {
              if (!mount || !rect) return
              const MARGIN = 4
              const vh = window.innerHeight
              const vw = window.innerWidth
              const ESTIMATED_H = 220
              const ESTIMATED_W = 280
              const spaceBelow = vh - rect.bottom - MARGIN
              const placeBelow = spaceBelow >= 160 || spaceBelow >= rect.top
              const top = placeBelow
                ? rect.bottom + MARGIN
                : Math.max(MARGIN, rect.top - ESTIMATED_H - MARGIN)
              const left = Math.min(
                Math.max(MARGIN, rect.left),
                vw - ESTIMATED_W - MARGIN,
              )
              mount.style.top = `${top}px`
              mount.style.left = `${left}px`
            }

            const renderList = (props: {
              items: readonly NodeRefItem[]
              command: (item: NodeRefItem) => void
              clientRect?: (() => DOMRect | null) | null
            }) => {
              if (!root) return
              positionMount(props.clientRect?.() ?? null)
              root.render(
                <VariableSuggestionList
                  ref={(r) => { listRef = r }}
                  items={props.items}
                  command={props.command}
                />,
              )
            }

            return {
              onStart: (props: never) => {
                mount = document.createElement("div")
                mount.style.position = "fixed"
                mount.style.zIndex = "9999"
                document.body.appendChild(mount)
                root = createRoot(mount)
                renderList(props as never)
              },
              onUpdate: (props: never) => renderList(props as never),
              onKeyDown: (props: { event: KeyboardEvent }) => listRef?.onKeyDown(props.event) ?? false,
              onExit: () => {
                if (root) {
                  const r = root
                  root = null
                  setTimeout(() => r.unmount(), 0)
                }
                if (mount) {
                  const m = mount
                  mount = null
                  setTimeout(() => m.remove(), 0)
                }
                listRef = null
              },
            }
          },
        },
      }),
    ], []), // intentionally created once — dynamic data flows via storage + refs
    content: valueToDoc(value),
    onUpdate: ({ editor: ed }) => {
      if (applyingExternalRef.current) return
      const text = ed.getText({ blockSeparator: "\n" })
      onChangeRef.current(text)
    },
  })

  // Push the latest reference list into editor storage so the React node
  // view can resolve `imageIndex` → URL without prop drilling.
  useEffect(() => {
    if (!editor) return
    const storage = editor.storage as unknown as Record<string, { referenceImages?: readonly RefImageItem[] }>
    storage.imageRef = storage.imageRef ?? {}
    storage.imageRef.referenceImages = referenceImages ?? []
    // Force node views to re-read storage by dispatching a no-op transaction.
    editor.view.dispatch(editor.state.tr.setMeta("imageRef-refs-changed", true))
  }, [editor, referenceImages])

  // Sync external value → editor when the prop changes from somewhere other
  // than this editor. Compare against the editor's serialized text to avoid
  // clobbering the cursor on every keystroke.
  useEffect(() => {
    if (!editor) return
    const current = editor.getText({ blockSeparator: "\n" })
    if (current === value) return
    applyingExternalRef.current = true
    try {
      editor.commands.setContent(valueToDoc(value), { emitUpdate: false })
    } finally {
      applyingExternalRef.current = false
    }
  }, [editor, value])

  const minHeight = rows ? `${rows * 1.5}rem` : undefined

  return (
    <div
      className={`prompt-editor rounded-md border border-input bg-transparent text-sm shadow-xs transition-colors ${className ?? ""}`}
      onClick={() => editor?.chain().focus().run()}
    >
      <EditorContent
        editor={editor}
        className="prompt-editor__content"
        style={{ minHeight }}
      />
    </div>
  )
}
