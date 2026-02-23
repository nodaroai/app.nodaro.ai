"use client"

import { useState, useRef, useCallback, useMemo } from "react"
import { ChevronDown, Play, Pause, Search } from "lucide-react"
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
import type { ElevenLabsVoice } from "@/lib/api"

interface VoiceBrowserProps {
  readonly value: string
  readonly onSelect: (name: string) => void
  readonly compact?: boolean
  /** When set, only voices whose name is in this set are shown. */
  readonly allowedVoiceNames?: ReadonlySet<string>
}

const GENDER_FILTERS = ["All", "Female", "Male", "Other"] as const
type GenderFilter = (typeof GENDER_FILTERS)[number]

function matchesGender(voice: ElevenLabsVoice, filter: GenderFilter): boolean {
  if (filter === "All") return true
  const g = voice.gender.toLowerCase()
  if (filter === "Female") return g === "female"
  if (filter === "Male") return g === "male"
  return g !== "female" && g !== "male"
}

function capitalize(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function VoiceBrowser({ value, onSelect, compact, allowedVoiceNames }: VoiceBrowserProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [genderFilter, setGenderFilter] = useState<GenderFilter>("All")
  const [accentFilter, setAccentFilter] = useState("All")
  const [playingId, setPlayingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const { data: allVoices = [] } = useVoices()

  const voices = useMemo(
    () => allowedVoiceNames ? allVoices.filter((v) => allowedVoiceNames.has(v.name)) : allVoices,
    [allVoices, allowedVoiceNames],
  )

  // Unique accents for dropdown
  const accents = useMemo(() => {
    const set = new Set<string>()
    for (const v of voices) {
      if (v.accent) set.add(v.accent)
    }
    return Array.from(set).sort()
  }, [voices])

  // Filtered voices
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return voices.filter((v) => {
      if (!matchesGender(v, genderFilter)) return false
      if (accentFilter !== "All" && v.accent !== accentFilter) return false
      if (q && !v.name.toLowerCase().includes(q) && !v.description.toLowerCase().includes(q) && !v.use_case.toLowerCase().includes(q)) return false
      return true
    })
  }, [voices, search, genderFilter, accentFilter])

  const handlePlay = useCallback((voice: ElevenLabsVoice) => {
    if (!voice.preview_url) return

    // If same voice playing, pause
    if (playingId === voice.name) {
      audioRef.current?.pause()
      setPlayingId(null)
      return
    }

    // Stop any current
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.removeAttribute("src")
    }

    // Create or reuse audio element
    if (!audioRef.current) {
      audioRef.current = new Audio()
      audioRef.current.addEventListener("ended", () => setPlayingId(null))
      audioRef.current.addEventListener("error", () => setPlayingId(null))
    }

    audioRef.current.src = voice.preview_url
    audioRef.current.play().catch(() => setPlayingId(null))
    setPlayingId(voice.name)
  }, [playingId])

  const handleSelect = useCallback((name: string) => {
    onSelect(name)
    setOpen(false)
    // Stop audio on close
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={`flex items-center justify-between rounded-md border border-input bg-transparent px-3 text-sm shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${compact ? "h-8 w-[140px] text-xs" : "h-9 w-full"}`}
        >
          <span className="truncate">{value || "Select voice"}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[80vh] flex flex-col gap-3 p-4">
        <DialogHeader>
          <DialogTitle>Browse Voices</DialogTitle>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search voices..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>

        {/* Filters row */}
        <div className="flex items-center gap-2">
          {/* Gender toggle buttons */}
          <div className="flex gap-1">
            {GENDER_FILTERS.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGenderFilter(g)}
                className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${genderFilter === g ? "border-primary bg-primary/10 text-primary font-medium" : "hover:bg-muted text-muted-foreground"}`}
              >
                {g}
              </button>
            ))}
          </div>

          {/* Accent dropdown */}
          {accents.length > 0 && (
            <Select value={accentFilter} onValueChange={setAccentFilter}>
              <SelectTrigger className="h-7 w-[120px] text-xs">
                <SelectValue placeholder="Accent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All accents</SelectItem>
                {accents.map((a) => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Voice list */}
        <div className="flex-1 overflow-y-auto min-h-0 max-h-[50vh] -mx-1 px-1">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No voices match your filters</p>
          ) : (
            <div className="flex flex-col gap-1">
              {filtered.map((voice) => {
                const isSelected = voice.name === value
                const isPlaying = playingId === voice.name
                return (
                  <button
                    key={voice.name}
                    type="button"
                    onClick={() => handleSelect(voice.name)}
                    className={`flex items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors ${isSelected ? "bg-primary/10 border border-primary/30" : "hover:bg-muted border border-transparent"}`}
                  >
                    {/* Play button */}
                    {voice.preview_url ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 mt-0.5"
                        onClick={(e) => {
                          e.stopPropagation()
                          handlePlay(voice)
                        }}
                      >
                        {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      </Button>
                    ) : (
                      <div className="h-7 w-7 shrink-0" />
                    )}

                    {/* Voice info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium truncate">{voice.name}</span>
                        {isSelected && (
                          <span className="text-xs text-primary">&#10003;</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {[
                          capitalize(voice.gender),
                          voice.accent,
                          voice.description || voice.use_case,
                        ].filter(Boolean).join(" \u00B7 ")}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
