"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Loader2, Mic, RefreshCw, Upload, AlertCircle, CheckCircle2 } from "lucide-react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { toast } from "sonner"
import {
  sunoVoiceValidateApi, sunoVoiceValidateInfoApi, sunoVoiceRegenerateApi,
  sunoVoiceGenerateApi, sunoVoiceRecordInfoApi, uploadAudio,
} from "@/lib/api"
import type {
  SunoVoiceData, SunoVoiceLanguage, SunoVoiceSkillLevel,
} from "@/types/nodes"

interface Props {
  nodeId: string
  data: SunoVoiceData
  open: boolean
  onClose: () => void
}

const LANGUAGE_LABELS: Record<SunoVoiceLanguage, string> = {
  en: "English", zh: "Chinese", es: "Spanish", fr: "French", pt: "Portuguese",
  de: "German",  ja: "Japanese", ko: "Korean", hi: "Hindi", ru: "Russian",
}

const SKILL_LABELS: Record<SunoVoiceSkillLevel, string> = {
  beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced", professional: "Professional",
}

type Step = 1 | 2 | 3

const VALIDATE_POLL_MS = 2_000
const VALIDATE_MAX_ATTEMPTS = 60          // 2 min
const RECORD_POLL_MS = 3_000
const RECORD_MAX_ATTEMPTS = 80            // 4 min

export function SunoVoiceSetupModal({ nodeId, data, open, onClose }: Props) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  // Step state — initialized from saved node data so a partially-completed
  // setup can be resumed.
  const initialStep: Step = data.voiceId ? 3
    : data.validateInfo ? 2
    : 1
  const [step, setStep] = useState<Step>(initialStep)

  // Stage 1 fields
  const [sourceUrl, setSourceUrl] = useState(data.sourceAudioUrl ?? "")
  const [vocalStart, setVocalStart] = useState(data.sourceVocalStartS ?? 0)
  const [vocalEnd, setVocalEnd] = useState(data.sourceVocalEndS ?? 10)
  const [language, setLanguage] = useState<SunoVoiceLanguage>(data.language ?? "en")
  const [validating, setValidating] = useState(false)
  const [validateTaskId, setValidateTaskId] = useState(data.validateTaskId ?? "")
  const [validateInfo, setValidateInfo] = useState(data.validateInfo ?? "")

  // Stage 2 fields
  const [verifyUrl, setVerifyUrl] = useState(data.verifyAudioUrl ?? "")
  const [uploadingVerify, setUploadingVerify] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [uploadingSource, setUploadingSource] = useState(false)

  // Stage 3 fields
  const [voiceName, setVoiceName] = useState(data.voiceName ?? "")
  const [description, setDescription] = useState(data.description ?? "")
  const [style, setStyle] = useState(data.style ?? "")
  const [skillLevel, setSkillLevel] = useState<SunoVoiceSkillLevel>(data.singerSkillLevel ?? "beginner")
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Refs to control polling loops on unmount/close.
  const pollAbort = useRef<AbortController | null>(null)
  useEffect(() => {
    return () => pollAbort.current?.abort()
  }, [])
  useEffect(() => {
    if (!open) pollAbort.current?.abort()
  }, [open])

  const segmentValid = useMemo(
    () => sourceUrl.trim().length > 0 && vocalEnd > vocalStart && vocalStart >= 0,
    [sourceUrl, vocalStart, vocalEnd],
  )

  function persist(patch: Partial<SunoVoiceData>): void {
    updateNodeData(nodeId, patch)
  }

  // ── Step 1: validate ─────────────────────────────────────────────────────
  async function handleValidate(): Promise<void> {
    if (!segmentValid) {
      toast.error("Provide an audio URL and a valid vocal segment.")
      return
    }
    setValidating(true)
    setError(null)
    persist({
      sourceAudioUrl: sourceUrl.trim(),
      sourceVocalStartS: vocalStart,
      sourceVocalEndS: vocalEnd,
      language,
      status: "validating",
      errorMessage: undefined,
    })
    try {
      const { taskId } = await sunoVoiceValidateApi({
        voiceUrl: sourceUrl.trim(),
        vocalStartS: vocalStart,
        vocalEndS: vocalEnd,
        language,
      })
      setValidateTaskId(taskId)
      persist({ validateTaskId: taskId })

      // Poll validate-info.
      const controller = new AbortController()
      pollAbort.current?.abort()
      pollAbort.current = controller
      const phrase = await pollValidateInfo(taskId, controller.signal)
      if (!phrase) return  // aborted or failed; state already handled.

      setValidateInfo(phrase)
      persist({ validateInfo: phrase, status: "wait_validating" })
      setStep(2)
    } catch (err) {
      const msg = (err as Error).message
      setError(msg)
      persist({ status: "fail", errorMessage: msg })
      toast.error(`Validation failed: ${msg}`)
    } finally {
      setValidating(false)
    }
  }

  async function pollValidateInfo(taskId: string, signal: AbortSignal): Promise<string | null> {
    for (let i = 0; i < VALIDATE_MAX_ATTEMPTS; i++) {
      if (signal.aborted) return null
      try {
        const info = await sunoVoiceValidateInfoApi(taskId)
        if (info.status === "wait_validating" && info.validateInfo) {
          return info.validateInfo
        }
        if (info.status === "fail" || info.status === "processing_validate_fail") {
          throw new Error(info.errorMessage || "Validation failed")
        }
      } catch (err) {
        // transient network errors are tolerable for first ~3 attempts; thereafter bubble up
        if (i > 2) throw err
      }
      await sleep(VALIDATE_POLL_MS, signal)
    }
    throw new Error("Validation timed out — try again or pick a different vocal segment")
  }

  async function handleRegenerate(): Promise<void> {
    if (!validateTaskId) return
    setRegenerating(true)
    setError(null)
    try {
      const { taskId } = await sunoVoiceRegenerateApi(validateTaskId)
      setValidateTaskId(taskId)
      setValidateInfo("")
      persist({ validateTaskId: taskId, validateInfo: undefined, status: "validating" })
      const controller = new AbortController()
      pollAbort.current?.abort()
      pollAbort.current = controller
      const phrase = await pollValidateInfo(taskId, controller.signal)
      if (phrase) {
        setValidateInfo(phrase)
        persist({ validateInfo: phrase, status: "wait_validating" })
      }
    } catch (err) {
      const msg = (err as Error).message
      setError(msg)
      toast.error(`Regenerate failed: ${msg}`)
    } finally {
      setRegenerating(false)
    }
  }

  // ── Step 2: upload verify recording ──────────────────────────────────────
  async function handleVerifyUpload(file: File): Promise<void> {
    setUploadingVerify(true)
    try {
      const { url } = await uploadAudio(file)
      setVerifyUrl(url)
      persist({ verifyAudioUrl: url })
    } catch (err) {
      toast.error(`Upload failed: ${(err as Error).message}`)
    } finally {
      setUploadingVerify(false)
    }
  }

  async function handleSourceUpload(file: File): Promise<void> {
    setUploadingSource(true)
    try {
      const { url } = await uploadAudio(file)
      setSourceUrl(url)
      persist({ sourceAudioUrl: url })
    } catch (err) {
      toast.error(`Upload failed: ${(err as Error).message}`)
    } finally {
      setUploadingSource(false)
    }
  }

  // ── Step 3: generate ─────────────────────────────────────────────────────
  async function handleGenerate(): Promise<void> {
    if (!validateTaskId || !verifyUrl.trim()) {
      toast.error("Missing validation task or verify recording.")
      return
    }
    setGenerating(true)
    setError(null)
    persist({
      voiceName: voiceName.trim() || undefined,
      description: description.trim() || undefined,
      style: style.trim() || undefined,
      singerSkillLevel: skillLevel,
      status: "generating",
      errorMessage: undefined,
    })
    try {
      const { jobId, kieTaskId } = await sunoVoiceGenerateApi({
        taskId: validateTaskId,
        verifyUrl: verifyUrl.trim(),
        voiceName: voiceName.trim() || undefined,
        description: description.trim() || undefined,
        style: style.trim() || undefined,
        singerSkillLevel: skillLevel,
      })
      persist({ generateJobId: jobId, generateKieTaskId: kieTaskId })

      const controller = new AbortController()
      pollAbort.current?.abort()
      pollAbort.current = controller
      const voiceId = await pollRecordInfo(kieTaskId, controller.signal)
      if (!voiceId) return

      persist({
        voiceId,
        status: "success",
        errorMessage: undefined,
      })
      toast.success(`Voice "${voiceName.trim() || "Untitled"}" is ready`)
      onClose()
    } catch (err) {
      const msg = (err as Error).message
      setError(msg)
      persist({ status: "fail", errorMessage: msg })
      toast.error(`Generation failed: ${msg}`)
    } finally {
      setGenerating(false)
    }
  }

  async function pollRecordInfo(taskId: string, signal: AbortSignal): Promise<string | null> {
    for (let i = 0; i < RECORD_MAX_ATTEMPTS; i++) {
      if (signal.aborted) return null
      try {
        const info = await sunoVoiceRecordInfoApi(taskId)
        if (info.status === "success" && info.voiceId) {
          return info.voiceId
        }
        if (info.status === "fail" || info.status === "processing_validate_fail") {
          throw new Error(info.errorMessage || "Voice generation failed")
        }
      } catch (err) {
        if (i > 2) throw err
      }
      await sleep(RECORD_POLL_MS, signal)
    }
    throw new Error("Voice generation timed out — check status later or try again")
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mic className="w-4 h-4 text-indigo-500" />
            Suno Voice Persona — Setup
          </DialogTitle>
          <DialogDescription>
            Create a custom voice from a short recording. Step {step} of 3
            {step === 3 && data.voiceId ? " — already generated" : ""}.
            Cost: <span className="font-medium">20 credits</span> charged once on Step 3.
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="srcUrl">Source recording URL</Label>
              <div className="flex gap-2">
                <Input
                  id="srcUrl"
                  type="url"
                  placeholder="https://example.com/voice.mp3"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                />
                <label className="inline-flex items-center justify-center px-3 rounded-md border bg-muted/40 cursor-pointer hover:bg-muted/60 transition">
                  {uploadingSource ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}
                  <input
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) void handleSourceUpload(file)
                      e.target.value = ""
                    }}
                  />
                </label>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Paste a hosted clip or upload an audio file. The selected vocal
                segment will be analyzed to build a validation phrase.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="vocalStart">Vocal segment start (s)</Label>
                <Input
                  id="vocalStart"
                  type="number"
                  min={0}
                  max={600}
                  value={vocalStart}
                  onChange={(e) => setVocalStart(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vocalEnd">Vocal segment end (s)</Label>
                <Input
                  id="vocalEnd"
                  type="number"
                  min={1}
                  max={600}
                  value={vocalEnd}
                  onChange={(e) => setVocalEnd(Math.max(1, Math.floor(Number(e.target.value) || 0)))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Phrase language</Label>
              <Select value={language} onValueChange={(v) => setLanguage(v as SunoVoiceLanguage)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(LANGUAGE_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {error && (
              <div className="flex items-start gap-2 p-2 rounded bg-red-500/5 text-red-500 text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                {error}
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Read this phrase aloud and upload the recording</Label>
              <div className="p-3 rounded-md border bg-muted/30 text-sm font-medium">
                {validateInfo || (
                  <span className="text-muted-foreground italic">Waiting for phrase…</span>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={regenerating || !validateTaskId}
                onClick={() => void handleRegenerate()}
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${regenerating ? "animate-spin" : ""}`} />
                Regenerate phrase
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="verifyUrl">Your recording</Label>
              <div className="flex gap-2">
                <Input
                  id="verifyUrl"
                  type="url"
                  placeholder="https://example.com/my-reading.mp3"
                  value={verifyUrl}
                  onChange={(e) => setVerifyUrl(e.target.value)}
                />
                <label className="inline-flex items-center justify-center px-3 rounded-md border bg-muted/40 cursor-pointer hover:bg-muted/60 transition">
                  {uploadingVerify ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}
                  <input
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) void handleVerifyUpload(file)
                      e.target.value = ""
                    }}
                  />
                </label>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Record yourself singing or speaking the phrase above, then
                upload. Singing produces a richer voice persona.
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2 p-2 rounded bg-red-500/5 text-red-500 text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                {error}
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="voiceName">Voice name</Label>
                <Input
                  id="voiceName"
                  placeholder="My Voice"
                  value={voiceName}
                  onChange={(e) => setVoiceName(e.target.value)}
                  maxLength={200}
                  disabled={Boolean(data.voiceId)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Singer skill level</Label>
                <Select
                  value={skillLevel}
                  onValueChange={(v) => setSkillLevel(v as SunoVoiceSkillLevel)}
                  disabled={Boolean(data.voiceId)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(SKILL_LABELS).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="style">Style (optional)</Label>
              <Input
                id="style"
                placeholder="Pop, female vocal"
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                maxLength={500}
                disabled={Boolean(data.voiceId)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                disabled={Boolean(data.voiceId)}
              />
            </div>

            {data.voiceId && (
              <div className="flex items-start gap-2 p-2 rounded bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 text-sm">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium">Voice persona ready</div>
                  <div className="font-mono text-[11px] mt-0.5 break-all">{data.voiceId}</div>
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 p-2 rounded bg-red-500/5 text-red-500 text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                {error}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex justify-between sm:justify-between gap-2">
          <div className="flex gap-2">
            {step > 1 && !data.voiceId && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={validating || regenerating || generating}
                onClick={() => setStep((step - 1) as Step)}
              >
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              {data.voiceId ? "Close" : "Cancel"}
            </Button>
            {step === 1 && (
              <Button
                type="button"
                size="sm"
                disabled={!segmentValid || validating}
                onClick={() => void handleValidate()}
              >
                {validating ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
                {validating ? "Getting phrase…" : "Get validation phrase"}
              </Button>
            )}
            {step === 2 && (
              <Button
                type="button"
                size="sm"
                disabled={!verifyUrl.trim()}
                onClick={() => setStep(3)}
              >
                Continue
              </Button>
            )}
            {step === 3 && !data.voiceId && (
              <Button
                type="button"
                size="sm"
                disabled={generating || !verifyUrl.trim() || !validateTaskId}
                onClick={() => void handleGenerate()}
              >
                {generating ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
                {generating ? "Creating voice…" : "Create voice (20 credits)"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    function onAbort(): void {
      clearTimeout(t)
      reject(new DOMException("aborted", "AbortError"))
    }
    signal.addEventListener("abort", onAbort, { once: true })
  })
}
