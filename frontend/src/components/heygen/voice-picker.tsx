"use client"

// frontend/src/components/heygen/voice-picker.tsx
//
// Rich, virtualized voice list for the HeyGen voice catalog (~2,330 entries).
// Consumed by:
//   • the ai-avatar node config panel (inline within the config drawer)
//   • published-app input cards (VoicePickerInputCard)
//
// Design constraints:
//   • Virtualized with @tanstack/react-virtual directly (useVirtualizer) — the
//     voice list is a tall, uniform-row list (not a grid), so the list
//     virtualizer is more natural than the grid hook. The picker renders inside
//     a fixed-height inner scroll container.
//   • Audio preview via the active-player singleton (one-at-a-time playback).
//   • Controls: search by name, language Select (distinct values), gender Select.
//   • Selected row highlighted with brand pink.

import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  useEffect,
} from "react"
import { useQuery } from "@tanstack/react-query"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Search, Play, Pause, AlertCircle, Volume2 } from "lucide-react"
import {
  getHeygenVoices,
  type HeygenVoice,
} from "@/lib/api"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import {
  setActivePlayer,
  releaseActivePlayer,
  type ActivePlayerHandle,
} from "@/components/audio-player/active-player"

// ---------------------------------------------------------------------------
// Pure helpers — extracted so tests can cover the filter logic without RTL
// ---------------------------------------------------------------------------

/** Return sorted list of distinct languages in the catalog. */
export function deriveLanguages(voices: readonly HeygenVoice[]): string[] {
  const seen = new Set<string>()
  for (const v of voices) {
    if (v.language) seen.add(v.language)
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b))
}

/** Return sorted list of distinct genders in the catalog. */
export function deriveVoiceGenders(voices: readonly HeygenVoice[]): string[] {
  const seen = new Set<string>()
  for (const v of voices) {
    if (v.gender) seen.add(v.gender.toLowerCase())
  }
  return Array.from(seen).sort()
}

/** Filter voices by search query, language, and gender. */
export function filterVoices(
  voices: readonly HeygenVoice[],
  query: string,
  language: string,
  gender: string,
): HeygenVoice[] {
  const q = query.trim().toLowerCase()
  return voices.filter((v) => {
    if (q && !v.name.toLowerCase().includes(q)) return false
    if (language !== "all" && v.language !== language) return false
    if (gender !== "all" && v.gender.toLowerCase() !== gender) return false
    return true
  })
}

// ---------------------------------------------------------------------------
// VoiceRow — a single row in the list
// ---------------------------------------------------------------------------

interface VoiceRowProps {
  readonly voice: HeygenVoice
  readonly selected: boolean
  readonly onSelect: (v: HeygenVoice) => void
}

const VoiceRow = memo(function VoiceRow({
  voice,
  selected,
  onSelect,
}: VoiceRowProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)

  // Stable handle for the active-player singleton. Created once per mount.
  const playerHandleRef = useRef<ActivePlayerHandle | null>(null)
  if (!playerHandleRef.current) {
    playerHandleRef.current = {
      pause: () => {
        audioRef.current?.pause()
        setIsPlaying(false)
      },
    }
  }

  // Release the singleton slot on unmount so it doesn't hold a stale ref.
  useEffect(() => {
    const handle = playerHandleRef.current
    return () => {
      if (handle) releaseActivePlayer(handle)
    }
  }, [])

  const handlePlayPause = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation() // don't trigger row selection
      if (!voice.previewAudio) return

      if (isPlaying) {
        audioRef.current?.pause()
        setIsPlaying(false)
      } else {
        // Register with the singleton — pauses whatever was playing.
        setActivePlayer(playerHandleRef.current!)
        if (!audioRef.current) {
          audioRef.current = new Audio(voice.previewAudio)
          audioRef.current.onended = () => setIsPlaying(false)
          audioRef.current.onpause = () => setIsPlaying(false)
        }
        audioRef.current.play().catch(() => setIsPlaying(false))
        setIsPlaying(true)
      }
    },
    [isPlaying, voice.previewAudio],
  )

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={`${voice.name}, ${voice.language}, ${voice.gender}`}
      onClick={() => onSelect(voice)}
      className={cn(
        "w-full flex items-center gap-2.5 px-2.5 py-2 text-left transition-colors rounded-md",
        selected
          ? "bg-[#ff0073]/10 ring-1 ring-[#ff0073]/40"
          : "hover:bg-muted/50",
      )}
    >
      {/* Play/Pause preview button */}
      <button
        type="button"
        aria-label={isPlaying ? `Pause ${voice.name}` : `Play ${voice.name}`}
        onClick={handlePlayPause}
        disabled={!voice.previewAudio}
        className={cn(
          "shrink-0 flex items-center justify-center size-6 rounded-full border transition-colors",
          isPlaying
            ? "border-[#ff0073] bg-[#ff0073] text-white"
            : "border-gray-300 dark:border-[#3D3D3D] text-muted-foreground hover:border-[#ff0073] hover:text-[#ff0073]",
          !voice.previewAudio && "opacity-30 cursor-not-allowed",
        )}
      >
        {isPlaying ? (
          <Pause className="size-3 fill-current" />
        ) : (
          <Play className="size-3 fill-current" />
        )}
      </button>

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={cn(
              "text-xs font-medium truncate",
              selected ? "text-[#ff0073]" : "text-foreground",
            )}
          >
            {voice.name}
          </span>
          {/* Feature badges */}
          {voice.emotionSupport && (
            <span className="shrink-0 inline-flex items-center text-[9px] font-medium px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
              emotion
            </span>
          )}
          {voice.supportPause && (
            <span className="shrink-0 inline-flex items-center text-[9px] font-medium px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
              pause
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[10px] text-muted-foreground truncate">
            {voice.language}
          </span>
          <span className="text-[10px] text-muted-foreground/60 capitalize">
            · {voice.gender}
          </span>
        </div>
      </div>

      {/* Selection dot */}
      {selected && (
        <span
          aria-hidden
          className="shrink-0 w-1.5 h-1.5 rounded-full bg-[#ff0073]"
        />
      )}
    </button>
  )
})

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface VoicePickerProps {
  /** Currently selected voiceId. */
  readonly value?: string
  /** Called with the full voice object on selection. */
  readonly onSelect: (voice: HeygenVoice) => void
  readonly className?: string
}

export const VoicePicker = memo(function VoicePicker({
  value,
  onSelect,
  className,
}: VoicePickerProps) {
  const { data: voices = [], isLoading, isError } = useQuery({
    queryKey: ["heygen-voices"],
    queryFn: getHeygenVoices,
    staleTime: 5 * 60 * 1000,
  })

  const [query, setQuery] = useState("")
  const [language, setLanguage] = useState("all")
  const [gender, setGender] = useState("all")

  const languages = useMemo(() => deriveLanguages(voices), [voices])
  const genders = useMemo(() => deriveVoiceGenders(voices), [voices])

  const filtered = useMemo(
    () => filterVoices(voices, query, language, gender),
    [voices, query, language, gender],
  )

  // Scroll container for the row virtualizer.
  const parentRef = useRef<HTMLDivElement | null>(null)

  const ROW_HEIGHT = 52 // px — name + meta + padding

  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
  })

  // -------------------------------------------------------------------------
  // Loading skeleton
  // -------------------------------------------------------------------------
  if (isLoading) {
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        <div className="h-8 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
        <div className="flex gap-2">
          <div className="h-8 flex-1 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
          <div className="h-8 w-24 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
        ))}
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------
  if (isError) {
    return (
      <div className={cn("flex flex-col items-center gap-2 py-8 text-center", className)}>
        <AlertCircle className="size-8 text-destructive/60" />
        <p className="text-sm text-muted-foreground">Failed to load voices</p>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Empty catalog — HeyGen API key not configured
  // -------------------------------------------------------------------------
  if (voices.length === 0) {
    return (
      <div
        className={cn("flex flex-col items-center gap-3 py-10 text-center px-4", className)}
        data-testid="voice-picker-empty"
      >
        <Volume2 className="size-10 text-muted-foreground/40" />
        <p className="text-sm font-medium text-muted-foreground">No HeyGen voices</p>
        <p className="text-xs text-muted-foreground/70">
          Configure the HeyGen API key in Settings to browse available voices.
        </p>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------------
  return (
    <div className={cn("flex flex-col gap-2 min-h-0", className)}>
      {/* Controls */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            aria-label="Search voices"
            placeholder="Search voices…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>

        <Select value={language} onValueChange={setLanguage}>
          <SelectTrigger
            aria-label="Filter by language"
            className="h-8 text-xs w-[120px] shrink-0"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-60">
            <SelectItem value="all" className="text-xs">All languages</SelectItem>
            {languages.map((lang) => (
              <SelectItem key={lang} value={lang} className="text-xs">
                {lang}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={gender} onValueChange={setGender}>
          <SelectTrigger
            aria-label="Filter by gender"
            className="h-8 text-xs w-[90px] shrink-0"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All genders</SelectItem>
            {genders.map((g) => (
              <SelectItem key={g} value={g} className="text-xs capitalize">
                {g.charAt(0).toUpperCase() + g.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Item count */}
      <p className="text-[10px] text-muted-foreground px-0.5">
        {filtered.length.toLocaleString()} voice{filtered.length !== 1 ? "s" : ""}
      </p>

      {/* Virtualized list */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <p className="text-xs text-muted-foreground">No voices match your filters</p>
        </div>
      ) : (
        <div
          ref={parentRef}
          role="radiogroup"
          aria-label="HeyGen voices"
          className="overflow-y-auto"
          style={{ height: 360 }}
        >
          <div
            style={{
              height: rowVirtualizer.getTotalSize(),
              width: "100%",
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const voice = filtered[virtualRow.index]
              if (!voice) return null
              return (
                <div
                  key={virtualRow.key}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <VoiceRow
                    voice={voice}
                    selected={value === voice.voiceId}
                    onSelect={onSelect}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
})
