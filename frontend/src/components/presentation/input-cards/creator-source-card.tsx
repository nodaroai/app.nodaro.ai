import { Label } from "@/components/ui/label"
import { useT } from "@/lib/i18n"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { GlassCard } from "../output-cards/shared"
import { ImageUploadCard } from "./image-upload-card"

interface CreatorSourceCardProps {
  readonly nodeId: string
  readonly label: string
  readonly data: Record<string, unknown>
  readonly isFullscreen: boolean
  readonly inputValues: Record<string, Record<string, unknown>>
  readonly onUpdateInput: (nodeId: string, key: string, value: unknown) => void
  readonly readOnly?: boolean
}

interface Choice {
  readonly value: string
  readonly label: string
}

/** UGC Creator's app card: who talks — an AI creator or the runner's photo — and the gender. */
export function CreatorSourceCard({ nodeId, label, data, isFullscreen, inputValues, onUpdateInput, readOnly }: CreatorSourceCardProps) {
  const t = useT()
  const read = (k: string): unknown => (isFullscreen ? inputValues[nodeId]?.[k] ?? data[k] : data[k])
  const write = (k: string, v: unknown) => {
    if (readOnly) return
    if (isFullscreen) onUpdateInput(nodeId, k, v)
    else useWorkflowStore.getState().updateNodeData(nodeId, { [k]: v })
  }
  const source = read("source") === "photo" ? "photo" : "sampled"
  const gender = read("gender") === "man" ? "man" : "woman"
  const rawPhoto = read("photoUrl")
  const photoUrl = typeof rawPhoto === "string" ? rawPhoto : undefined
  // ImageUploadCard speaks `url`; this node's field is `photoUrl`.
  const photoInputs = { ...inputValues, [nodeId]: { ...(inputValues[nodeId] ?? {}), url: photoUrl } }
  const onPhotoInput = (_id: string, key: string, value: unknown) => write(key === "url" ? "photoUrl" : key, value)

  const group = (ariaLabel: string, field: string, current: string, choices: readonly Choice[]) => (
    <div role="radiogroup" aria-label={ariaLabel} className="flex gap-2 mt-2">
      {choices.map((c) => {
        const active = c.value === current
        return (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={readOnly}
            className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${active ? "border-[#ff0073] bg-[#ff0073]/10" : "border-border bg-muted/40"}`}
            onClick={() => write(field, c.value)}
          >
            {c.label}
          </button>
        )
      })}
    </div>
  )

  return (
    <GlassCard>
      <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</Label>
      {group(t("creatorCard.sourceLabel"), "source", source, [
        { value: "sampled", label: t("creatorCard.aiCreator") },
        { value: "photo", label: t("creatorCard.myPhoto") },
      ])}
      {group(t("creatorCard.genderLabel"), "gender", gender, [
        { value: "woman", label: t("creatorCard.woman") },
        { value: "man", label: t("creatorCard.man") },
      ])}
      {source === "photo" && (
        <div className="mt-3">
          <ImageUploadCard label={t("creatorCard.photoLabel")} url={photoUrl} nodeId={nodeId} isFullscreen inputValues={photoInputs} onUpdateInput={onPhotoInput} readOnly={readOnly} />
          <p className="mt-2 text-[11px] text-muted-foreground">{t("creatorCard.photoConsent")}</p>
        </div>
      )}
    </GlassCard>
  )
}
