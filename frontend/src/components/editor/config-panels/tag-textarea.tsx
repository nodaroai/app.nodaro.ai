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
  readonly referenceImages?: readonly RefImageItem[]
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
  thumbnailUrl?: string
}

/** A reference image that can be inserted into the prompt via the "@" trigger. */
export interface RefImageItem {
  readonly url: string
  readonly label: string
  readonly source: "uploaded" | "wired" | "character"
  /** 1-based position matching {image:N} in the prompt. */
  readonly index: number
  /** Default role label inserted by the "@" trigger (e.g. "object", "person"). */
  readonly defaultLabel: string
}

type TriggerChar = "[" | "<" | "/" | "{" | "@"

const REF_IMAGE_SOURCE_LABEL: Record<RefImageItem["source"], string> = {
  uploaded: "Uploaded",
  wired: "Wired",
  character: "Character",
}

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
  const { value, onChange, placeholder, rows, className, maxLength, nodeRefs, referenceImages, displayMode = "raw", refMap } = props
  const tagMode: "audio" | "suno" | "none" = props.tagMode ?? "none"
  const provider = props.tagMode === "audio" ? props.provider : undefined
  const customTags = props.tagMode === "suno" ? props.customTags : undefined
  const [showDropdown, setShowDropdown] = useState(false)
  const [triggerInfo, setTriggerInfo] = useState<{ char: TriggerChar; position: number } | null>(null)
  const [filterText, setFilterText] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [warning, setWarning] = useState<string | null>(null)
  const [imagePreview, setImagePreview] = useState<{ url: string; anchor: DOMRect } | null>(null)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null)
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

  const refImageSuggestions = useMemo((): SuggestionItem[] => {
    if (!referenceImages || referenceImages.length === 0) return []
    return referenceImages.map((r) => ({
      tag: `{image:${r.index}:${r.defaultLabel}}`,
      label: `#${r.index} ${r.label}`,
      category: REF_IMAGE_SOURCE_LABEL[r.source],
      thumbnailUrl: r.url,
    }))
  }, [referenceImages])

  const filtered = useMemo(() => {
    if (!showDropdown || !triggerInfo) return []
    const q = filterText.toLowerCase()

    let items: readonly SuggestionItem[]
    if (triggerInfo.char === "{") {
      items = nodeRefSuggestions
    } else if (triggerInfo.char === "@") {
      items = refImageSuggestions
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
  }, [showDropdown, triggerInfo, filterText, customTags, nodeRefSuggestions, refImageSuggestions, tagMode])

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

  // Compute dropdown position relative to viewport. Flips above the textarea
  // when there isn't enough room below, and caps the height so the list is
  // always scrollable within view — previously opened below only and got
  // clipped off-screen near the bottom of the config panel.
  const updateDropdownPos = useCallback(() => {
    if (!wrapperRef.current) return
    const rect = wrapperRef.current.getBoundingClientRect()
    const vh = window.innerHeight
    const MARGIN = 8
    const IDEAL_MAX_H = 256 // matches `max-h-64`
    const spaceBelow = Math.max(0, vh - rect.bottom - MARGIN)
    const spaceAbove = Math.max(0, rect.top - MARGIN)
    // Prefer below, but flip if there's more room above and below is tight.
    const flipUp = spaceBelow < 160 && spaceAbove > spaceBelow
    if (flipUp) {
      const maxHeight = Math.min(IDEAL_MAX_H, spaceAbove)
      setDropdownPos({
        top: rect.top - maxHeight - 4,
        left: rect.left,
        width: rect.width,
        maxHeight,
      })
    } else {
      setDropdownPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        maxHeight: Math.min(IDEAL_MAX_H, spaceBelow),
      })
    }
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
    const isAtTrigger = charBefore === "@" && referenceImages && referenceImages.length > 0

    if (isBracketTrigger || isSsmlTrigger || isBraceTrigger || isAtTrigger) {
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

      // Dismiss if user typed a closing bracket/brace or went before trigger.
      // "@" has no closing char — matches "{" behavior (dismiss via Escape or click-outside).
      const closingChars =
        triggerInfo.char === "{" ? "}"
        : triggerInfo.char === "<" ? ">"
        : triggerInfo.char === "@" ? null
        : "]"
      const hitClosing = closingChars !== null && textSinceTrigger.includes(closingChars)
      if (cursor <= triggerInfo.position || hitClosing) {
        dismiss()
      } else {
        setFilterText(textSinceTrigger)
        setSelectedIndex(0)
      }
    }
  }, [maxLength, onChange, showDropdown, triggerInfo, nodeRefs, referenceImages, tagMode, dismiss, updateDropdownPos])

  // Locate every {image:N} or {image:N:label} token in the current value so
  // navigation/deletion can treat each token as one atomic unit.
  const findImageTokens = useCallback((): Array<{ start: number; end: number }> => {
    const tokens: Array<{ start: number; end: number }> = []
    for (const m of value.matchAll(/\{image:\d+(?::[a-zA-Z0-9_-]+)?\}/gi)) {
      const start = m.index ?? 0
      tokens.push({ start, end: start + m[0].length })
    }
    return tokens
  }, [value])

  const removeTokenAt = useCallback((start: number, end: number) => {
    const newValue = value.slice(0, start) + value.slice(end)
    onChange(newValue)
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = start
        textareaRef.current.selectionEnd = start
        textareaRef.current.focus()
      }
    })
  }, [value, onChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Autocomplete dropdown navigation (only when dropdown is open)
    if (showDropdown && filtered.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIndex((i) => (i + 1) % filtered.length)
        return
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length)
        return
      } else if (e.key === "Enter") {
        e.preventDefault()
        const item = filtered[selectedIndex]
        if (item) insertTag(item.tag)
        return
      } else if (e.key === "Escape") {
        e.preventDefault()
        dismiss()
        return
      }
    }

    // Atomic image-token navigation/deletion. Only act on simple cursor
    // movements (no selection, no modifier-key shortcuts).
    const ta = textareaRef.current
    if (!ta || ta.selectionStart !== ta.selectionEnd) return
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
    const cursor = ta.selectionStart
    const tokens = findImageTokens()

    if (e.key === "Backspace") {
      // Token immediately before cursor → delete whole token in one keystroke.
      const tok = tokens.find((t) => t.end === cursor)
      if (tok) {
        e.preventDefault()
        removeTokenAt(tok.start, tok.end)
      }
    } else if (e.key === "Delete") {
      // Token immediately after cursor → delete whole token.
      const tok = tokens.find((t) => t.start === cursor)
      if (tok) {
        e.preventDefault()
        removeTokenAt(tok.start, tok.end)
      }
    } else if (e.key === "ArrowLeft") {
      // Cursor at end of token → jump to start (skip over token contents).
      const tok = tokens.find((t) => t.end === cursor)
      if (tok) {
        e.preventDefault()
        ta.selectionStart = tok.start
        ta.selectionEnd = tok.start
      }
    } else if (e.key === "ArrowRight") {
      // Cursor at start of token → jump to end.
      const tok = tokens.find((t) => t.start === cursor)
      if (tok) {
        e.preventDefault()
        ta.selectionStart = tok.end
        ta.selectionEnd = tok.end
      }
    }
  }, [showDropdown, filtered, selectedIndex, insertTag, dismiss, findImageTokens, removeTokenAt])

  // Snap cursor to nearest token boundary when a click lands inside a token.
  const handleSelect = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    if (ta.selectionStart !== ta.selectionEnd) return // user is selecting a range — leave it alone
    const cursor = ta.selectionStart
    const tokens = findImageTokens()
    const inside = tokens.find((t) => cursor > t.start && cursor < t.end)
    if (inside) {
      const snapTo = (cursor - inside.start) < (inside.end - cursor) ? inside.start : inside.end
      ta.selectionStart = snapTo
      ta.selectionEnd = snapTo
    }
  }, [findImageTokens])

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
  const hasRefImages = referenceImages && referenceImages.length > 0
  const hasBraceTokens = hasNodeRefs || hasRefImages
  const highlightPattern = tagMode === "none"
    ? (hasBraceTokens ? NODE_REF_PATTERN : null)
    : (hasBraceTokens ? COMBINED_PATTERN : TAG_PATTERN)

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
    const re = new RegExp(highlightPattern.source, "g")
    for (const match of value.matchAll(re)) {
      const matchIndex = match.index ?? 0
      if (matchIndex > lastIndex) {
        parts.push(value.slice(lastIndex, matchIndex))
      }
      const text = match[0]
      const imageRefMatch = text.match(/^\{image:(\d+)(?::([a-zA-Z0-9_-]+))?\}$/i)
      if (imageRefMatch && referenceImages) {
        const n = parseInt(imageRefMatch[1], 10)
        const labelPart = imageRefMatch[2] ?? ""
        const ref = n >= 1 ? referenceImages[n - 1] : undefined
        const tokenStart = matchIndex
        const tokenEnd = matchIndex + text.length
        parts.push(
          <span
            key={matchIndex}
            className="image-ref-pill"
          >
            {ref?.url && (
              <img
                src={ref.url}
                alt=""
                className="image-ref-pill__thumb"
                onMouseEnter={(e) =>
                  setImagePreview({ url: ref.url, anchor: e.currentTarget.getBoundingClientRect() })
                }
                onMouseLeave={() => setImagePreview(null)}
              />
            )}
            <span className="image-ref-pill__label">
              @image:{n}{labelPart && `:${labelPart}`}
            </span>
            <button
              type="button"
              aria-label="Remove image reference"
              className="image-ref-pill__remove"
              onMouseDown={(e) => {
                // Use mousedown so the textarea doesn't reclaim focus before
                // we can read its selection / call onChange.
                e.preventDefault()
                removeTokenAt(tokenStart, tokenEnd)
              }}
            >
              ×
            </button>
          </span>,
        )
      } else {
        const isNodeRef = text.startsWith("{")
        parts.push(
          <mark key={matchIndex} className={isNodeRef ? "node-ref-highlight" : "tag-highlight"}>{text}</mark>,
        )
      }
      lastIndex = matchIndex + text.length
    }
    if (lastIndex < value.length) {
      parts.push(value.slice(lastIndex))
    }
    // Trailing newline: browsers collapse it in the div, add extra to keep scroll height in sync
    if (value.endsWith("\n")) {
      parts.push("\n")
    }
    return parts
  }, [value, highlightPattern, referenceImages, removeTokenAt])

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
        minWidth: Math.max(dropdownPos.width, 200),
        maxHeight: dropdownPos.maxHeight,
      }}
      className="z-[9999] overflow-y-auto rounded-lg border border-border bg-popover shadow-lg py-1"
    >
      {Array.from(groupedFiltered.entries()).map(([category, items]) => (
        <div key={category}>
          <div className="sticky top-0 bg-muted/80 backdrop-blur-sm px-2.5 py-1 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/50">
            {category}
          </div>
          {items.map((item) => {
            const idx = filtered.indexOf(item)
            const isSelected = idx === selectedIndex
            const isRefImage = item.thumbnailUrl !== undefined
            const isNodeRef = !isRefImage && category !== "Audio Tags" && category !== "Suno"
            return (
              <button
                key={item.tag}
                type="button"
                data-index={idx}
                className={`w-full text-left px-2.5 py-1.5 text-[11px] cursor-pointer transition-colors flex items-center gap-2 ${
                  isSelected
                    ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
                    : "hover:bg-muted text-foreground"
                }`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  insertTag(item.tag)
                }}
              >
                {isRefImage && (
                  <>
                    <img
                      src={item.thumbnailUrl}
                      alt=""
                      className="w-7 h-7 rounded object-cover shrink-0 border border-border/40"
                    />
                    <span className="truncate flex-1 min-w-0">{item.label}</span>
                    <span
                      className={`inline-flex items-center rounded-md border px-1.5 py-0 text-[10px] font-mono font-medium leading-4 shrink-0 ${
                        isSelected
                          ? "border-sky-400/60 bg-sky-500/20 text-sky-700 dark:text-sky-200"
                          : "border-sky-400/40 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                      }`}
                    >
                      {item.tag}
                    </span>
                  </>
                )}
                {isNodeRef && (
                  <span
                    className={`inline-flex items-center rounded-md border px-1.5 py-0 text-[10px] font-mono font-medium leading-4 ${
                      isSelected
                        ? "border-sky-400/60 bg-sky-500/20 text-sky-700 dark:text-sky-200"
                        : "border-sky-400/40 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                    }`}
                  >
                    {item.tag}
                  </span>
                )}
                {!isNodeRef && !isRefImage && (
                  <span className="font-mono text-[11px]">{item.tag}</span>
                )}
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
              onSelect={handleSelect}
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
      {imagePreview && createPortal(
        (() => {
          const { url, anchor } = imagePreview
          const PREVIEW_MAX = 220
          const MARGIN = 8
          const vh = window.innerHeight
          const vw = window.innerWidth
          // Prefer below the thumbnail; flip above if there's more headroom.
          const spaceBelow = vh - anchor.bottom - MARGIN
          const spaceAbove = anchor.top - MARGIN
          const placeBelow = spaceBelow >= PREVIEW_MAX || spaceBelow >= spaceAbove
          const top = placeBelow
            ? anchor.bottom + MARGIN
            : Math.max(MARGIN, anchor.top - PREVIEW_MAX - MARGIN)
          // Keep within viewport horizontally; align left edge to the thumbnail.
          const left = Math.min(Math.max(MARGIN, anchor.left), vw - PREVIEW_MAX - MARGIN)
          return (
            <div
              style={{ position: "fixed", top, left }}
              className="z-[10000] pointer-events-none rounded-md shadow-xl bg-popover border border-border p-1"
              aria-hidden
            >
              <img
                src={url}
                alt=""
                className="block rounded object-contain"
                style={{ maxWidth: PREVIEW_MAX, maxHeight: PREVIEW_MAX }}
              />
            </div>
          )
        })(),
        document.body,
      )}
    </div>
  )
}
