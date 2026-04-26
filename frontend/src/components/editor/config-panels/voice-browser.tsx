import { useState, useRef, useCallback, useMemo, useEffect } from "react"
import { ChevronDown, Play, Pause, Search, Loader2, Mic, Upload, Trash2, Square, SlidersHorizontal, Info } from "lucide-react"
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
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { FitText } from "@/components/ui/fit-text"
import { ALL_LANGUAGES } from "@/lib/audio-tags"
import { useVoices } from "@/hooks/use-voices"
import { useVoiceLibrary } from "@/hooks/use-voices"
import { useVoiceClones, useCreateVoiceClone, useDeleteVoiceClone } from "@/hooks/use-voice-clones"
import { getCachedCredits, prefetchModelCredits } from "@/hooks/use-model-credits"
import { toast } from "sonner"

interface VoiceBrowserProps {
  readonly value: string              // voice_id UUID or legacy name
  readonly valueLabel?: string        // display name for trigger button
  readonly onSelect: (voiceId: string, voiceName: string, voiceType?: "premade" | "custom" | "library") => void
  readonly compact?: boolean
  readonly showCustomVoices?: boolean  // default false — only TTS node sets this
}

const GENDER_FILTERS = ["All", "Female", "Male", "Other"] as const
type GenderFilter = (typeof GENDER_FILTERS)[number]

const LIBRARY_CATEGORIES = [
  { key: "featured", label: "Featured", isFeatured: true },
  { key: "professional", label: "Professional", isFeatured: false },
  { key: "famous", label: "Famous", isFeatured: false },
] as const

const SORT_OPTIONS = [
  { value: "trending", label: "Trending" },
  { value: "latest", label: "Latest" },
  { value: "most_users", label: "Most Popular" },
  { value: "usage", label: "Most Used" },
] as const

const ACCENT_OPTIONS = [
  "american", "british", "australian", "indian", "african", "irish",
  "italian", "german", "french", "spanish", "latin", "scandinavian",
  "korean", "japanese", "chinese", "arabic", "portuguese", "dutch",
  "polish", "turkish", "swedish", "russian",
] as const

const AGE_OPTIONS = [
  { value: "young", label: "Young" },
  { value: "middle_aged", label: "Middle Aged" },
  { value: "old", label: "Old" },
] as const

const USE_CASE_OPTIONS = [
  { value: "advertisement", label: "Advertisement" },
  { value: "characters_animation", label: "Characters & Animation" },
  { value: "conversational", label: "Conversational" },
  { value: "entertainment_tv", label: "Entertainment & TV" },
  { value: "informative_educational", label: "Informative & Educational" },
  { value: "narrative_story", label: "Narrative & Story" },
  { value: "social_media", label: "Social Media" },
] as const

const TONE_OPTIONS = [
  "anxious", "calm", "casual", "chill", "classy", "confident", "crisp",
  "cute", "deep", "excited", "formal", "gentle", "grumpy", "husky",
  "hyped", "intense", "mature", "meditative", "modulated", "neutral",
  "pleasant", "professional", "raspy", "relaxed", "rough", "sad",
  "sassy", "serious", "soft", "upbeat", "whispery", "wise",
] as const

type TabId = "my-voices" | "premade" | "library"

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

export function VoiceBrowser({ value, valueLabel, onSelect, compact, showCustomVoices }: VoiceBrowserProps) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<TabId>(showCustomVoices ? "my-voices" : "premade")

  // -- Premade tab state --
  const [premadeSearch, setPremadeSearch] = useState("")
  const [premadeGender, setPremadeGender] = useState<GenderFilter>("All")
  const [premadeAccent, setPremadeAccent] = useState("All")

  // -- Library tab state --
  const [librarySearch, setLibrarySearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [libraryGender, setLibraryGender] = useState<GenderFilter>("All")
  const [libraryPage, setLibraryPage] = useState(0)
  const [libraryCategory, setLibraryCategory] = useState<string | undefined>(undefined)
  const [libraryFeatured, setLibraryFeatured] = useState(false)
  const [librarySort, setLibrarySort] = useState("trending")
  const [libraryHighQuality, setLibraryHighQuality] = useState(false)
  const [libraryAccent, setLibraryAccent] = useState("All")
  const [libraryAge, setLibraryAge] = useState("All")
  const [libraryLanguage, setLibraryLanguage] = useState("All")
  const [libraryUseCase, setLibraryUseCase] = useState("All")
  const [libraryDescriptive, setLibraryDescriptive] = useState("All")
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)

  const hasActiveAdvancedFilters = libraryAccent !== "All" || libraryAge !== "All" || libraryLanguage !== "All" || libraryUseCase !== "All" || libraryDescriptive !== "All"

  const resetAllFilters = useCallback(() => {
    setLibrarySearch("")
    setDebouncedSearch("")
    setLibraryGender("All")
    setLibraryCategory(undefined)
    setLibraryFeatured(false)
    setLibraryHighQuality(false)
    setLibrarySort("trending")
    setLibraryAccent("All")
    setLibraryAge("All")
    setLibraryLanguage("All")
    setLibraryUseCase("All")
    setLibraryDescriptive("All")
    setLibraryPage(0)
  }, [])

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
      category: libraryHighQuality ? "high_quality" : libraryCategory,
      featured: libraryFeatured ? "true" : undefined,
      sort: librarySort !== "trending" ? librarySort : undefined,
      accent: libraryAccent !== "All" ? libraryAccent : undefined,
      age: libraryAge !== "All" ? libraryAge : undefined,
      language: libraryLanguage !== "All" ? libraryLanguage : undefined,
      use_cases: libraryUseCase !== "All" ? libraryUseCase : undefined,
      descriptives: libraryDescriptive !== "All" ? libraryDescriptive : undefined,
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

    if (!audioRef.current) {
      audioRef.current = new Audio()
      audioRef.current.addEventListener("ended", () => setPlayingId(null))
      audioRef.current.addEventListener("error", () => setPlayingId(null))
    } else {
      audioRef.current.pause()
    }

    audioRef.current.src = previewUrl
    audioRef.current.play().catch(() => setPlayingId(null))
    setPlayingId(id)
  }, [playingId])

  const handleSelect = useCallback((voiceId: string, voiceName: string, voiceType?: "premade" | "custom" | "library") => {
    onSelect(voiceId, voiceName, voiceType)
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

  const tabs: TabId[] = showCustomVoices ? ["my-voices", "premade", "library"] : ["premade", "library"]
  const tabLabels: Record<TabId, string> = {
    "my-voices": "My Voices",
    premade: "Premade",
    library: "Voice Library",
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={`flex items-center justify-between rounded-md border border-input bg-transparent px-3 text-sm shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${compact ? "h-8 w-[140px] text-xs" : "h-9 w-full"}`}
        >
          <FitText text={displayLabel} />
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[80vh] flex flex-col gap-3 p-4">
        <DialogHeader>
          <DialogTitle>Browse Voices</DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border pb-1">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors ${tab === t ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              {tabLabels[t]}
            </button>
          ))}
        </div>

        {tab === "my-voices" && showCustomVoices && (
          <MyVoicesTab
            selectedValue={value}
            playingId={playingId}
            onPlay={handlePlay}
            onSelect={(voiceId, voiceName) => handleSelect(voiceId, voiceName, "custom")}
          />
        )}

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
              onSelect={(v) => handleSelect(v.id, v.name, "premade")}
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

            {/* Category chips + HQ toggle */}
            <div className="flex items-center gap-1 flex-wrap">
              {LIBRARY_CATEGORIES.map((cat) => {
                const isActive = cat.isFeatured
                  ? libraryFeatured
                  : libraryCategory === cat.key
                return (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => {
                      if (cat.isFeatured) {
                        setLibraryFeatured(!libraryFeatured)
                        if (!libraryFeatured) setLibraryCategory(undefined)
                      } else {
                        setLibraryCategory(isActive ? undefined : cat.key)
                        if (!isActive) setLibraryFeatured(false)
                      }
                      setLibraryPage(0)
                    }}
                    className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${isActive ? "border-primary bg-primary/10 text-primary font-medium" : "hover:bg-muted text-muted-foreground"}`}
                  >
                    {cat.label}
                  </button>
                )
              })}
              <span className="mx-1 h-4 w-px bg-border" />
              <button
                type="button"
                onClick={() => { setLibraryHighQuality(!libraryHighQuality); setLibraryPage(0) }}
                className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-full border transition-colors ${libraryHighQuality ? "border-primary bg-primary/10 text-primary font-medium" : "hover:bg-muted text-muted-foreground"}`}
              >
                <span className={`inline-flex h-3 w-3 items-center justify-center rounded-sm border text-[8px] leading-none ${libraryHighQuality ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}>
                  {libraryHighQuality && "✓"}
                </span>
                High Quality
              </button>
            </div>

            {/* Gender chips + Sort */}
            <div className="flex items-center gap-2">
              <div className="flex gap-1 flex-1">
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
              <Select value={librarySort} onValueChange={(v) => { setLibrarySort(v); setLibraryPage(0) }}>
                <SelectTrigger className="h-7 w-[120px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Advanced filters toggle + reset */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                className={`flex items-center gap-1 text-xs transition-colors ${hasActiveAdvancedFilters ? "text-primary font-medium" : "text-muted-foreground hover:text-foreground"}`}
              >
                <SlidersHorizontal className="h-3 w-3" />
                {showAdvancedFilters ? "Hide filters" : "More filters"}
                {!showAdvancedFilters && hasActiveAdvancedFilters && (
                  <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
                )}
              </button>
              {(hasActiveAdvancedFilters || libraryGender !== "All" || libraryCategory || libraryFeatured || libraryHighQuality || debouncedSearch) && (
                <button
                  type="button"
                  onClick={resetAllFilters}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Reset
                </button>
              )}
            </div>

            {showAdvancedFilters && (
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Select value={libraryAccent} onValueChange={(v) => { setLibraryAccent(v); setLibraryPage(0) }}>
                    <SelectTrigger className="h-7 text-xs flex-1">
                      <SelectValue placeholder="Accent" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="All">All accents</SelectItem>
                      {ACCENT_OPTIONS.map((a) => (
                        <SelectItem key={a} value={a}>{capitalize(a)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={libraryAge} onValueChange={(v) => { setLibraryAge(v); setLibraryPage(0) }}>
                    <SelectTrigger className="h-7 text-xs flex-1">
                      <SelectValue placeholder="Age" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="All">All ages</SelectItem>
                      {AGE_OPTIONS.map((a) => (
                        <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={libraryLanguage} onValueChange={(v) => { setLibraryLanguage(v); setLibraryPage(0) }}>
                    <SelectTrigger className="h-7 text-xs flex-1">
                      <SelectValue placeholder="Language" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="All">All languages</SelectItem>
                      {ALL_LANGUAGES.map((l) => (
                        <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2">
                  <Select value={libraryUseCase} onValueChange={(v) => { setLibraryUseCase(v); setLibraryPage(0) }}>
                    <SelectTrigger className="h-7 text-xs flex-1">
                      <SelectValue placeholder="Use case" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="All">All use cases</SelectItem>
                      {USE_CASE_OPTIONS.map((uc) => (
                        <SelectItem key={uc.value} value={uc.value}>{uc.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={libraryDescriptive} onValueChange={(v) => { setLibraryDescriptive(v); setLibraryPage(0) }}>
                    <SelectTrigger className="h-7 text-xs flex-1">
                      <SelectValue placeholder="Tone" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="All">All tones</SelectItem>
                      {TONE_OPTIONS.map((d) => (
                        <SelectItem key={d} value={d}>{capitalize(d)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

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
                  onSelect={(v) => handleSelect(v.id, v.name, "library")}
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
                    No voices found — try adjusting your filters
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

function MyVoicesTab({
  selectedValue,
  playingId,
  onPlay,
  onSelect,
}: {
  readonly selectedValue: string
  readonly playingId: string | null
  readonly onPlay: (previewUrl: string, id: string) => void
  readonly onSelect: (voiceId: string, voiceName: string) => void
}) {
  useEffect(() => { prefetchModelCredits(["voice-clone"]) }, [])
  const { data: voiceClones = [], isLoading } = useVoiceClones()
  const createMutation = useCreateVoiceClone()
  const deleteMutation = useDeleteVoiceClone()

  // -- Recording state --
  const [isRecording, setIsRecording] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [recordingTime, setRecordingTime] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recordedUrlRef = useRef<string | null>(null)

  // -- Upload state --
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // -- Submission --
  const [voiceName, setVoiceName] = useState("")
  const [showForm, setShowForm] = useState<"record" | "upload" | null>(null)

  const hasAudio = recordedBlob || uploadedFile

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm"
      const recorder = new MediaRecorder(stream, { mimeType })
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType })
        setRecordedBlob(blob)
        stream.getTracks().forEach((t) => t.stop())
      }

      recorder.start()
      mediaRecorderRef.current = recorder
      setIsRecording(true)
      setRecordingTime(0)
      timerRef.current = setInterval(() => {
        setRecordingTime((t) => t + 1)
      }, 1000)
    } catch {
      toast.error("Could not access microphone")
    }
  }, [])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop()
    }
    setIsRecording(false)
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const cancelRecording = useCallback(() => {
    stopRecording()
    setRecordedBlob(null)
    setShowForm(null)
    setVoiceName("")
  }, [stopRecording])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setUploadedFile(file)
      setShowForm("upload")
    }
  }, [])

  const handleSubmitClone = useCallback(async () => {
    const blob = recordedBlob || uploadedFile
    if (!blob || !voiceName.trim()) return

    try {
      await createMutation.mutateAsync({ name: voiceName.trim(), file: blob })
      toast.success("Voice cloned successfully")
      setRecordedBlob(null)
      setUploadedFile(null)
      setVoiceName("")
      setShowForm(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clone voice")
    }
  }, [recordedBlob, uploadedFile, voiceName, createMutation])

  const handleDeleteClone = useCallback(async (id: string) => {
    try {
      await deleteMutation.mutateAsync(id)
      toast.success("Voice deleted")
    } catch {
      toast.error("Failed to delete voice")
    }
  }, [deleteMutation])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop()
      }
      if (recordedUrlRef.current) URL.revokeObjectURL(recordedUrlRef.current)
    }
  }, [])

  const recordedPreviewUrl = useMemo(() => {
    if (recordedUrlRef.current) URL.revokeObjectURL(recordedUrlRef.current)
    if (!recordedBlob) { recordedUrlRef.current = null; return null }
    const url = URL.createObjectURL(recordedBlob)
    recordedUrlRef.current = url
    return url
  }, [recordedBlob])

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`

  return (
    <div className="flex flex-col gap-3">
      {/* Action buttons */}
      {!showForm && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => { setShowForm("record"); setRecordedBlob(null); setUploadedFile(null); setVoiceName("") }}
          >
            <Mic className="h-3.5 w-3.5 mr-1.5" />
            Record Voice
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            Upload Audio
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".wav,.mp3,.webm,.m4a,audio/*"
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>
      )}

      {/* Recording panel */}
      {showForm === "record" && !recordedBlob && (
        <div className="rounded-md border border-border p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {isRecording ? `Recording... ${formatTime(recordingTime)}` : "Ready to record"}
            </span>
            <div className="flex gap-1.5">
              {!isRecording ? (
                <Button size="sm" variant="default" onClick={startRecording} className="h-7 text-xs">
                  <Mic className="h-3 w-3 mr-1" />
                  Start
                </Button>
              ) : (
                <Button size="sm" variant="destructive" onClick={stopRecording} className="h-7 text-xs">
                  <Square className="h-3 w-3 mr-1" />
                  Stop
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={cancelRecording} className="h-7 text-xs">
                Cancel
              </Button>
            </div>
          </div>
          {isRecording && (
            <div className="flex gap-0.5 items-end h-6">
              {Array.from({ length: 20 }).map((_, i) => (
                <div
                  key={i}
                  className="w-1 bg-primary/60 rounded-full animate-pulse"
                  style={{
                    height: `${4 + Math.random() * 16}px`,
                    animationDelay: `${i * 50}ms`,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Post-record / upload form */}
      {showForm && hasAudio && (
        <div className="rounded-md border border-border p-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground flex-1">
              {recordedBlob ? `Recorded (${formatTime(recordingTime)})` : uploadedFile?.name}
            </span>
            {recordedPreviewUrl && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                aria-label="Play recorded audio"
                onClick={() => {
                  const a = new Audio(recordedPreviewUrl)
                  a.play().catch(() => {})
                }}
              >
                <Play className="h-3 w-3" />
              </Button>
            )}
          </div>
          <Input
            placeholder="Voice name..."
            value={voiceName}
            onChange={(e) => setVoiceName(e.target.value)}
            className="h-8 text-sm"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1 h-8 text-xs"
              disabled={!voiceName.trim() || createMutation.isPending}
              onClick={handleSubmitClone}
            >
              {createMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : null}
              {`Clone Voice (${getCachedCredits("voice-clone") ?? 5} CR)`}
            </Button>
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={cancelRecording}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Existing clones list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : voiceClones.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No custom voices yet. Record or upload audio to clone a voice.
        </p>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0 max-h-[50vh] -mx-1 px-1">
          <div className="flex flex-col gap-1">
            {voiceClones.map((clone) => {
              const isSelected = clone.elevenlabsVoiceId === selectedValue
              const isPlaying = playingId === clone.id
              return (
                <button
                  key={clone.id}
                  type="button"
                  onClick={() => onSelect(clone.elevenlabsVoiceId, clone.name)}
                  className={`flex items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors ${isSelected ? "bg-primary/10 border border-primary/30" : "hover:bg-muted border border-transparent"}`}
                >
                  {clone.sampleAudioUrl ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 mt-0.5"
                      aria-label={isPlaying ? "Pause voice preview" : "Play voice preview"}
                      onClick={(e) => {
                        e.stopPropagation()
                        onPlay(clone.sampleAudioUrl!, clone.id)
                      }}
                    >
                      {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    </Button>
                  ) : (
                    <div className="h-7 w-7 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <FitText text={clone.name} className="text-sm font-medium" />
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary shrink-0">
                        Custom
                      </span>
                      {isSelected && (
                        <span className="text-xs text-primary">&#10003;</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Created {new Date(clone.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 mt-0.5 text-destructive hover:text-destructive"
                    aria-label="Delete voice clone"
                    disabled={deleteMutation.isPending}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteClone(clone.id)
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

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
              className={`group relative flex items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors ${isSelected ? "bg-primary/10 border border-primary/30" : "hover:bg-muted border border-transparent"}`}
            >
              {voice.preview_url ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 mt-0.5"
                  aria-label={isPlaying ? "Pause voice preview" : "Play voice preview"}
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
                  <FitText text={voice.name} className="text-sm font-medium" />
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

              {voice.description && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      role="button"
                      aria-label="Voice description"
                      className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-accent"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Info className="h-3.5 w-3.5 text-muted-foreground" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-xs">
                    {voice.description}
                  </TooltipContent>
                </Tooltip>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
