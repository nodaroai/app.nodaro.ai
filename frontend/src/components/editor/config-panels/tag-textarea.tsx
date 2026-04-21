import { useState, useRef, useCallback, useMemo, useEffect, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Textarea } from "@/components/ui/textarea"
import { AUDIO_TAGS, SSML_BREAK_OPTIONS, isV2Model } from "@/lib/audio-tags"
import type { NodeRefItem } from "@/lib/node-refs"
import type { VariableDisplayMode } from "./types"
import { renderNodeRefs } from "@/lib/render-node-refs"

/** Regex to match bracket tags like [whispers], [Verse 2], <break time="1s" /> */
const TAG_PATTERN = /(\[[^\]]+\]|<break[^>]*\/>)/g

/** Combined pattern for highlighting both tags and node refs */
const COMBINED_PATTERN = /(\[[^\]]+\]|<break[^>]*\/>|\{[^}]+\})/g

/** Node-ref-only pattern used when tagMode is "none" but there are node refs */
const NODE_REF_PATTERN = /(\{[^}]+\})/g

interface BaseProps {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly placeholder?: string
  readonly rows?: number
  readonly className?: string
  readonly maxLength?: number
  readonly nodeRefs?: readonly NodeRefItem[]
  readonly displayMode?: VariableDisplayMode
  readonly refMap?: Map<string, string>
}

type TagTextareaProps = BaseProps & (
  | { tagMode?: "none" }
  | { tagMode: "audio"; provider?: string }
  | { tagMode: "suno"; customTags: readonly SuggestionItem[] }
)

export interface SuggestionItem {
  tag: string
  label: string
  category: string
}

type TriggerChar = "[" | "<" | "/" | "{"

function getAllSuggestions(): SuggestionItem[] {
  const items: SuggestionItem[] = AUDIO_TAGS.map((t) => ({
    tag: t.tag,
    label: t.label,
    category: t.category,
  }))
  for (const b of SSML_BREAK_OPTIONS) {
    items.push({ tag: b.tag, label: b.label, category: "SSML Breaks" })
  }
  return items
}

const ALL_SUGGESTIONS = getAllSuggestions()

const SSML_SUGGESTIONS: SuggestionItem[] = SSML_BREAK_OPTIONS.map((b) => ({
  tag: b.tag,
  label: b.label,
  category: "SSML Breaks",
}))

/** Map node type to a human-readable category for the dropdown */
function nodeTypeCategory(type: string): string {
  if (["text-prompt", "ai-writer", "list", "loop"].includes(type)) return "Text"
  if (["generate-image", "upload-image", "edit-image", "image-to-image", "character", "face", "object", "location", "scene"].includes(type)) return "Image"
  if (["image-to-video", "text-to-video", "video-to-video", "upload-video", "youtube-video", "combine-videos", "extend-video"].includes(type)) return "Video"
  if (["text-to-speech", "generate-music", "text-to-audio", "upload-audio", "suno-generate"].includes(type)) return "Audio"
  return "Node"
}

export function TagTextarea(props: TagTextareaProps) {
  const { value, onChange, placeholder, rows, className, maxLength, nodeRefs, displayMode = "raw", refMap } = props
  const tagMode: "audio" | "suno" | "none" = props.tagMode ?? "none"
  const provider = props.tagMode === "audio" ? props.provider : undefined
  const customTags = props.tagMode === "suno" ? props.customTags : undefined
  const [showDropdown, setShowDropdown] = useState(false)
  const [triggerInfo, setTriggerInfo] = useState<{ char: TriggerChar; position: number } | null>(null)
  const [filterText, setFilterText] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [warning, setWarning] = useState<string | null>(null)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  const nodeRefSuggestions = useMemo((): SuggestionItem[] => {
    if (!nodeRefs || nodeRefs.length === 0) return []
    return nodeRefs.map((ref) => ({
      tag: `{${ref.label}}`,
      label: ref.label,
      category: nodeTypeCategory(ref.type),
    }))
  }, [nodeRefs])

  const filtered = useMemo(() => {
    if (!showDropdown || !triggerInfo) return []
    const q = filterText.toLowerCase()

    let items: readonly SuggestionItem[]
    if (triggerInfo.char === "{") {
      items = nodeRefSuggestions
    } else if (tagMode === "suno") {
      if (!customTags) return []
      if (triggerInfo.char === "<") return []
      items = customTags
    } else if (tagMode === "audio") {
      items = triggerInfo.char === "<" ? SSML_SUGGESTIONS : ALL_SUGGESTIONS
    } else {
      return []
    }

    if (!q) return items
    return items.filter((s) => s.label.toLowerCase().includes(q) || s.category.toLowerCase().includes(q))
  }, [showDropdown, triggerInfo, filterText, customTags, nodeRefSuggestions, tagMode])

  const groupedFiltered = useMemo(() => {
    const map = new Map<string, SuggestionItem[]>()
    for (const item of filtered) {
      const existing = map.get(item.category) ?? []
      existing.push(item)
      map.set(item.category, existing)
    }
    return map
  }, [filtered])

  const dismiss = useCallback(() => {
    setShowDropdown(false)
    setTriggerInfo(null)
    setFilterText("")
    setSelectedIndex(0)
    setWarning(null)
    setDropdownPos(null)
  }, [])

  // Compute dropdown position relative to viewport when showing
  const updateDropdownPos = useCallback(() => {
    if (!wrapperRef.current) return
    const rect = wrapperRef.current.getBoundingClientRect()
    setDropdownPos({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    })
  }, [])

  const insertTag = useCallback((tag: string) => {
    if (!triggerInfo || !textareaRef.current) return

    const before = value.slice(0, triggerInfo.position)
    const cursorPos = textareaRef.current.selectionStart
    const after = value.slice(cursorPos)

    const newValue = before + tag + " " + after
    if (maxLength && newValue.length > maxLength) return

    onChange(newValue)

    if (tagMode === "audio") {
      const isAudioTag = tag.startsWith("[")
      const isSsmlTag = tag.startsWith("<")
      if (isSsmlTag && provider !== undefined && !isV2Model(provider)) {
        setWarning("SSML breaks work best with Turbo v2.5 or Multilingual v2")
      } else if (isAudioTag && provider !== undefined && isV2Model(provider)) {
        setWarning("Audio tags like " + tag + " work best with ElevenLabs v3")
      }
    }

    dismiss()

    // Restore cursor
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        const newPos = before.length + tag.length + 1
        textareaRef.current.selectionStart = newPos
        textareaRef.current.selectionEnd = newPos
        textareaRef.current.focus()
      }
    })
  }, [triggerInfo, value, onChange, maxLength, provider, tagMode, dismiss])

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    if (maxLength && newValue.length > maxLength) return
    onChange(newValue)

    const cursor = e.target.selectionStart
    const charBefore = newValue[cursor - 1]

    const isBraceTrigger = charBefore === "{" && nodeRefs && nodeRefs.length > 0
    const isBracketTrigger = (charBefore === "[" || charBefore === "/") && tagMode !== "none"
    const isSsmlTrigger = charBefore === "<" && tagMode === "audio"

    if (isBracketTrigger || isSsmlTrigger || isBraceTrigger) {
      const trigger = charBefore as TriggerChar
      setTriggerInfo({ char: trigger, position: cursor - 1 })
      setFilterText("")
      setSelectedIndex(0)
      setShowDropdown(true)
      setWarning(null)
      updateDropdownPos()
    } else if (showDropdown && triggerInfo) {
      // Update filter text
      const textSinceTrigger = newValue.slice(triggerInfo.position + 1, cursor)

      // Dismiss if user typed a closing bracket/brace or went before trigger
      const closingChars = triggerInfo.char === "{" ? "}" : triggerInfo.char === "<" ? ">" : "]"
      if (cursor <= triggerInfo.position || textSinceTrigger.includes(closingChars)) {
        dismiss()
      } else {
        setFilterText(textSinceTrigger)
        setSelectedIndex(0)
      }
    }
  }, [maxLength, onChange, showDropdown, triggerInfo, nodeRefs, tagMode, dismiss, updateDropdownPos])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showDropdown || filtered.length === 0) return

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedIndex((i) => (i + 1) % filtered.length)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length)
    } else if (e.key === "Enter") {
      e.preventDefault()
      const item = filtered[selectedIndex]
      if (item) {
        insertTag(item.tag)
      }
    } else if (e.key === "Escape") {
      e.preventDefault()
      dismiss()
    }
  }, [showDropdown, filtered, selectedIndex, insertTag, dismiss])

  // Dismiss on outside click
  useEffect(() => {
    if (!showDropdown) return
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current?.contains(e.target as Node)) return
      if (textareaRef.current?.contains(e.target as Node)) return
      dismiss()
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [showDropdown, dismiss])

  // Clear transient insert-time warning after 4 seconds
  useEffect(() => {
    if (!warning) return
    const timer = setTimeout(() => setWarning(null), 4000)
    return () => clearTimeout(timer)
  }, [warning])

  // Scroll selected item into view
  useEffect(() => {
    if (!showDropdown || !dropdownRef.current) return
    const el = dropdownRef.current.querySelector(`[data-index="${selectedIndex}"]`)
    if (el) el.scrollIntoView({ block: "nearest" })
  }, [selectedIndex, showDropdown])

  const hasNodeRefs = nodeRefs && nodeRefs.length > 0
  const highlightPattern = tagMode === "none"
    ? (hasNodeRefs ? NODE_REF_PATTERN : null)
    : (hasNodeRefs ? COMBINED_PATTERN : TAG_PATTERN)

  // Build highlighted backdrop content
  const highlightedContent = useMemo((): ReactNode[] => {
    if (!value) return []
    if (!highlightPattern) {
      const parts: ReactNode[] = [value]
      if (value.endsWith("\n")) parts.push("\n")
      return parts
    }
    const parts: ReactNode[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null
    const re = new RegExp(highlightPattern.source, "g")
    while ((match = re.exec(value)) !== null) {
      if (match.index > lastIndex) {
        parts.push(value.slice(lastIndex, match.index))
      }
      const text = match[0]
      const isNodeRef = text.startsWith("{")
      parts.push(
        <mark key={match.index} className={isNodeRef ? "node-ref-highlight" : "tag-highlight"}>{text}</mark>,
      )
      lastIndex = re.lastIndex
    }
    if (lastIndex < value.length) {
      parts.push(value.slice(lastIndex))
    }
    // Trailing newline: browsers collapse it in the div, add extra to keep scroll height in sync
    if (value.endsWith("\n")) {
      parts.push("\n")
    }
    return parts
  }, [value, highlightPattern])

  // Sync scroll from textarea to backdrop
  const backdropRef = useRef<HTMLDivElement | null>(null)
  const handleScroll = useCallback(() => {
    if (textareaRef.current && backdropRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop
      backdropRef.current.scrollLeft = textareaRef.current.scrollLeft
    }
  }, [])

  const renderFormattedText = useMemo(() => {
    if (displayMode === "raw" || !refMap) return null
    return renderNodeRefs(value || "", refMap, displayMode)
  }, [displayMode, refMap, value])

  const dropdown = showDropdown && filtered.length > 0 && dropdownPos && createPortal(
    <div
      ref={dropdownRef}
      style={{
        position: "fixed",
        top: dropdownPos.top,
        left: dropdownPos.left,
        width: dropdownPos.width,
      }}
      className="z-[9999] max-h-52 overflow-y-auto rounded-md border border-border bg-popover shadow-md"
    >
      {Array.from(groupedFiltered.entries()).map(([category, items]) => (
        <div key={category}>
          <div className="sticky top-0 bg-muted px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            {category}
          </div>
          {items.map((item) => {
            const idx = filtered.indexOf(item)
            return (
              <button
                key={item.tag}
                type="button"
                data-index={idx}
                className={`w-full text-left px-3 py-1.5 text-xs cursor-pointer transition-colors ${idx === selectedIndex ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  insertTag(item.tag)
                }}
              >
                <span className="font-mono text-[11px]">{item.tag}</span>
              </button>
            )
          })}
        </div>
      ))}
    </div>,
    document.body,
  )

  return (
    <div ref={wrapperRef} className="relative">
      {displayMode !== "raw" && renderFormattedText ? (
        <div
          className="rounded-md border border-border bg-muted/30 p-3 text-sm text-foreground whitespace-pre-wrap leading-relaxed"
          style={{ minHeight: rows ? `${rows * 1.5}rem` : undefined }}
          role="textbox"
          aria-readonly="true"
        >
          {renderFormattedText}
        </div>
      ) : (
        <>
          <div className="tag-textarea-container">
            <div
              ref={backdropRef}
              aria-hidden
              className="tag-textarea-backdrop"
            >
              {highlightedContent}
            </div>
            <Textarea
              ref={textareaRef}
              rows={rows}
              value={value}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onScroll={handleScroll}
              placeholder={placeholder}
              className={`tag-textarea-input ${className ?? ""}`}
            />
          </div>
          {dropdown}
        </>
      )}
      {warning && (
        <p className="text-[10px] text-amber-500 mt-1">{warning}</p>
      )}
    </div>
  )
}
