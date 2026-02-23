"use client"

import { useState, useRef, useCallback, useMemo, useEffect } from "react"
import { ChevronDown, Play, Pause, Search, Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { useVoices } from "@/hooks/use-voices"
import { useVoiceLibrary } from "@/hooks/use-voices"
import type { ElevenLabsVoice } from "@/lib/api"

interface VoiceBrowserProps {
  readonly value: string              // voice_id UUID or legacy name
  readonly valueLabel?: string        // display name for trigger button
  readonly onSelect: (voiceId: string, voiceName: string) => void
  readonly compact?: boolean
}

const GENDER_FILTERS = ["All", "Female", "Male", "Other"] as const
type GenderFilter = (typeof GENDER_FILTERS)[number]

type TabId = "premade" | "library"

function matchesGender(gender: string, filter: GenderFilter): boolean {
  if (filter === "All") return true
  const g = gender.toLowerCase()
  if (filter === "Female") return g === "female"
  if (filter === "Male") return g === "male"
  return g !== "female" && g !== "male"
}

function capitalize(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function VoiceBrowser({ value, valueLabel, onSelect, compact }: VoiceBrowserProps) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<TabId>("premade")

  // -- Premade tab state --
  const [premadeSearch, setPremadeSearch] = useState("")
  const [premadeGender, setPremadeGender] = useState<GenderFilter>("All")
  const [premadeAccent, setPremadeAccent] = useState("All")

  // -- Library tab state --
  const [librarySearch, setLibrarySearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [libraryGender, setLibraryGender] = useState<GenderFilter>("All")
  const [libraryPage, setLibraryPage] = useState(0)

  // -- Audio --
  const [playingId, setPlayingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Debounce library search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(librarySearch)
      setLibraryPage(0)
    }, 400)
    return () => clearTimeout(timer)
  }, [librarySearch])

  // -- Data sources --
  const { data: allPremade = [] } = useVoices()

  const libraryGenderParam = libraryGender === "All" ? undefined : libraryGender.toLowerCase()
  const { data: libraryData, isFetching: libraryLoading } = useVoiceLibrary(
    {
      search: debouncedSearch || undefined,
      gender: libraryGenderParam,
      page: libraryPage,
      page_size: 30,
    },
    tab === "library",
  )

  // Premade filtering (client-side)
  const premadeAccents = useMemo(() => {
    const set = new Set<string>()
    for (const v of allPremade) {
      if (v.accent) set.add(v.accent)
    }
    return Array.from(set).sort()
  }, [allPremade])

  const filteredPremade = useMemo(() => {
    const q = premadeSearch.toLowerCase()
    return allPremade.filter((v) => {
      if (!matchesGender(v.gender, premadeGender)) return false
      if (premadeAccent !== "All" && v.accent !== premadeAccent) return false
      if (q && !v.name.toLowerCase().includes(q) && !v.description.toLowerCase().includes(q) && !v.use_case.toLowerCase().includes(q)) return false
      return true
    })
  }, [allPremade, premadeSearch, premadeGender, premadeAccent])

  const handlePlay = useCallback((previewUrl: string, id: string) => {
    if (!previewUrl) return

    if (playingId === id) {
      audioRef.current?.pause()
      setPlayingId(null)
      return
    }

    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.removeAttribute("src")
    }

    if (!audioRef.current) {
      audioRef.current = new Audio()
      audioRef.current.addEventListener("ended", () => setPlayingId(null))
      audioRef.current.addEventListener("error", () => setPlayingId(null))
    }

    audioRef.current.src = previewUrl
    audioRef.current.play().catch(() => setPlayingId(null))
    setPlayingId(id)
  }, [playingId])

  const handleSelect = useCallback((voiceId: string, voiceName: string) => {
    onSelect(voiceId, voiceName)
    setOpen(false)
    if (audioRef.current) {
      audioRef.current.pause()
      setPlayingId(null)
    }
  }, [onSelect])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen && audioRef.current) {
      audioRef.current.pause()
      setPlayingId(null)
    }
  }, [])

  const displayLabel = valueLabel || value || "Select voice"

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={`flex items-center justify-between rounded-md border border-input bg-transparent px-3 text-sm shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${compact ? "h-8 w-[140px] text-xs" : "h-9 w-full"}`}
        >
          <span className="truncate">{displayLabel}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[80vh] flex flex-col gap-3 p-4">
        <DialogHeader>
          <DialogTitle>Browse Voices</DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border pb-1">
          {(["premade", "library"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors ${tab === t ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t === "premade" ? "Premade" : "Voice Library"}
            </button>
          ))}
        </div>

        {tab === "premade" && (
          <>
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search voices..."
                value={premadeSearch}
                onChange={(e) => setPremadeSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>

            {/* Filters */}
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                {GENDER_FILTERS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setPremadeGender(g)}
                    className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${premadeGender === g ? "border-primary bg-primary/10 text-primary font-medium" : "hover:bg-muted text-muted-foreground"}`}
                  >
                    {g}
                  </button>
                ))}
              </div>
              {premadeAccents.length > 0 && (
                <Select value={premadeAccent} onValueChange={setPremadeAccent}>
                  <SelectTrigger className="h-7 w-[120px] text-xs">
                    <SelectValue placeholder="Accent" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All accents</SelectItem>
                    {premadeAccents.map((a) => (
                      <SelectItem key={a} value={a}>{a}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Voice list */}
            <VoiceList
              voices={filteredPremade.map((v) => ({
                id: v.voice_id || v.name,
                name: v.name,
                preview_url: v.preview_url,
                gender: v.gender,
                accent: v.accent,
                description: v.description || v.use_case,
                category: "",
              }))}
              selectedValue={value}
              playingId={playingId}
              onPlay={handlePlay}
              onSelect={(v) => handleSelect(v.id, v.name)}
            />
          </>
        )}

        {tab === "library" && (
          <>
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search the voice library..."
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>

            {/* Gender filter */}
            <div className="flex gap-1">
              {GENDER_FILTERS.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => { setLibraryGender(g); setLibraryPage(0) }}
                  className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${libraryGender === g ? "border-primary bg-primary/10 text-primary font-medium" : "hover:bg-muted text-muted-foreground"}`}
                >
                  {g}
                </button>
              ))}
            </div>

            {/* Results */}
            {libraryLoading && (!libraryData || libraryData.voices.length === 0) ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <VoiceList
                  voices={(libraryData?.voices ?? []).map((v) => ({
                    id: v.voice_id,
                    name: v.name,
                    preview_url: v.preview_url,
                    gender: v.gender,
                    accent: v.accent,
                    description: v.description || v.use_case,
                    category: v.category,
                  }))}
                  selectedValue={value}
                  playingId={playingId}
                  onPlay={handlePlay}
                  onSelect={(v) => handleSelect(v.id, v.name)}
                  showCategory
                />
                {libraryData?.hasMore && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={libraryLoading}
                    onClick={() => setLibraryPage((p) => p + 1)}
                  >
                    {libraryLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                    Load more
                  </Button>
                )}
                {!libraryLoading && libraryData?.voices.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    {debouncedSearch ? "No voices found" : "Search to explore thousands of community voices"}
                  </p>
                )}
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Shared voice list component
// ---------------------------------------------------------------------------

interface VoiceListItem {
  id: string
  name: string
  preview_url: string
  gender: string
  accent: string
  description: string
  category: string
}

function VoiceList({
  voices,
  selectedValue,
  playingId,
  onPlay,
  onSelect,
  showCategory,
}: {
  readonly voices: VoiceListItem[]
  readonly selectedValue: string
  readonly playingId: string | null
  readonly onPlay: (previewUrl: string, id: string) => void
  readonly onSelect: (voice: VoiceListItem) => void
  readonly showCategory?: boolean
}) {
  if (voices.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">No voices match your filters</p>
  }

  return (
    <div className="flex-1 overflow-y-auto min-h-0 max-h-[50vh] -mx-1 px-1">
      <div className="flex flex-col gap-1">
        {voices.map((voice) => {
          const isSelected = voice.id === selectedValue || voice.name === selectedValue
          const isPlaying = playingId === voice.id
          return (
            <button
              key={voice.id}
              type="button"
              onClick={() => onSelect(voice)}
              className={`flex items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors ${isSelected ? "bg-primary/10 border border-primary/30" : "hover:bg-muted border border-transparent"}`}
            >
              {voice.preview_url ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 mt-0.5"
                  onClick={(e) => {
                    e.stopPropagation()
                    onPlay(voice.preview_url, voice.id)
                  }}
                >
                  {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </Button>
              ) : (
                <div className="h-7 w-7 shrink-0" />
              )}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium truncate">{voice.name}</span>
                  {showCategory && voice.category && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
                      {voice.category}
                    </span>
                  )}
                  {isSelected && (
                    <span className="text-xs text-primary">&#10003;</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {[
                    capitalize(voice.gender),
                    voice.accent,
                    voice.description,
                  ].filter(Boolean).join(" \u00B7 ")}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
