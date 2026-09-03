"use client"

import { useT, tx, type MessageKey } from "@/lib/i18n"
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

const LANGUAGE_LABEL_KEYS: Record<SunoVoiceLanguage, MessageKey> = {
  en: "langname.en", zh: "langname.zh", es: "langname.es", fr: "langname.fr", pt: "langname.pt",
  de: "langname.de", ja: "langname.ja", ko: "langname.ko", hi: "langname.hi", ru: "langname.ru",
}

const SKILL_LABEL_KEYS: Record<SunoVoiceSkillLevel, MessageKey> = {
  beginner: "node.skillBeginner", intermediate: "node.skillIntermediate",
  advanced: "node.skillAdvanced", professional: "node.skillProfessional",
}

type Step = 1 | 2 | 3

const VALIDATE_POLL_MS = 2_000
const VALIDATE_MAX_ATTEMPTS = 60          // 2 min
const RECORD_POLL_MS = 3_000
const RECORD_MAX_ATTEMPTS = 80            // 4 min

export function SunoVoiceSetupModal({ nodeId, data, open, onClose }: Props) {
  const t = useT()
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
      toast.error(tx("node.provideAudioUrlAndSegment"))
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
      toast.error(tx("node.validationFailedWith", { message: msg }))
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
          throw new Error(info.errorMessage || tx("node.validationFailed"))
        }
      } catch (err) {
        // transient network errors are tolerable for first ~3 attempts; thereafter bubble up
        if (i > 2) throw err
      }
      await sleep(VALIDATE_POLL_MS, signal)
    }
    throw new Error(tx("node.validationTimedOut"))
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
      toast.error(tx("node.regenerateFailedWith", { message: msg }))
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
      toast.error(tx("node.uploadFailedWith", { message: (err as Error).message }))
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
      toast.error(tx("node.uploadFailedWith", { message: (err as Error).message }))
    } finally {
      setUploadingSource(false)
    }
  }

  // ── Step 3: generate ─────────────────────────────────────────────────────
  async function handleGenerate(): Promise<void> {
    if (!validateTaskId || !verifyUrl.trim()) {
      toast.error(tx("node.missingValidationTask"))
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
      toast.success(tx("node.voiceIsReady", { name: voiceName.trim() || tx("exec.untitled") }))
      onClose()
    } catch (err) {
      const msg = (err as Error).message
      setError(msg)
      persist({ status: "fail", errorMessage: msg })
      toast.error(tx("node.generationFailedWith", { message: msg }))
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
          throw new Error(info.errorMessage || tx("node.voiceGenerationFailed"))
        }
      } catch (err) {
        if (i > 2) throw err
      }
      await sleep(RECORD_POLL_MS, signal)
    }
    throw new Error(tx("node.voiceGenerationTimedOut"))
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mic className="w-4 h-4 text-indigo-500" />
            {t("node.sunoVoicePersonaSetup")}
          </DialogTitle>
          <DialogDescription>
            {t("node.sunoSetupStepOf3", { step })}
            {step === 3 && data.voiceId ? <>{" "}{t("node.sunoSetupAlreadyGenerated")}</> : null}
            {". "}
            {t("node.sunoSetupCostPre")}{" "}
            <span className="font-medium">{t("node.sunoSetupCostCredits")}</span>{" "}
            {t("node.sunoSetupCostPost")}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="srcUrl">{t("node.sourceRecordingUrl")}</Label>
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
                {t("node.pasteAHostedClipOr")}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="vocalStart">{t("node.vocalSegmentStartS")}</Label>
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
                <Label htmlFor="vocalEnd">{t("node.vocalSegmentEndS")}</Label>
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
              <Label>{t("node.phraseLanguage")}</Label>
              <Select value={language} onValueChange={(v) => setLanguage(v as SunoVoiceLanguage)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(LANGUAGE_LABEL_KEYS).map(([key, messageKey]) => (
                    <SelectItem key={key} value={key}>{t(messageKey)}</SelectItem>
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
              <Label>{t("node.readThisPhraseAloudAnd")}</Label>
              <div className="p-3 rounded-md border bg-muted/30 text-sm font-medium">
                {validateInfo || (
                  <span className="text-muted-foreground italic">{t("node.waitingForPhrase")}</span>
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
                {t("node.regeneratePhrase")}
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="verifyUrl">{t("node.yourRecording")}</Label>
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
                {t("node.recordYourselfSingingOrSpeaking")}
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
                <Label htmlFor="voiceName">{t("node.voiceName")}</Label>
                <Input
                  id="voiceName"
                  placeholder={t("node.myVoice")}
                  value={voiceName}
                  onChange={(e) => setVoiceName(e.target.value)}
                  maxLength={200}
                  disabled={Boolean(data.voiceId)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("node.singerSkillLevel")}</Label>
                <Select
                  value={skillLevel}
                  onValueChange={(v) => setSkillLevel(v as SunoVoiceSkillLevel)}
                  disabled={Boolean(data.voiceId)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(SKILL_LABEL_KEYS).map(([key, messageKey]) => (
                      <SelectItem key={key} value={key}>{t(messageKey)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="style">{t("audiocfg.styleOptional")}</Label>
              <Input
                id="style"
                placeholder={t("node.popFemaleVocal")}
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                maxLength={500}
                disabled={Boolean(data.voiceId)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description">{t("node.descriptionOptional")}</Label>
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
                  <div className="font-medium">{t("node.voicePersonaReady")}</div>
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
                {t("common.back")}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              {data.voiceId ? t("common.close") : t("common.cancel")}
            </Button>
            {step === 1 && (
              <Button
                type="button"
                size="sm"
                disabled={!segmentValid || validating}
                onClick={() => void handleValidate()}
              >
                {validating ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
                {validating ? t("node.gettingPhrase") : t("node.getValidationPhrase")}
              </Button>
            )}
            {step === 2 && (
              <Button
                type="button"
                size="sm"
                disabled={!verifyUrl.trim()}
                onClick={() => setStep(3)}
              >
                {t("node.continue")}
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
                {generating ? t("node.creatingVoice") : t("node.createVoiceCredits")}
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
