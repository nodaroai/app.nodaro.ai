import { listedSeedanceTaskType, supportsReferenceTaskType, SEEDANCE_EDIT_REF_VIDEO_SEC, type DeclaredSeedanceTaskType } from "@nodaro/shared/models"
import type { SeedanceTaskTypeAsRun } from "@/lib/seedance-task-type"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useT, type MessageKey } from "@/lib/i18n"
import { isSeedanceDraftOn } from "./seedance-draft-toggle"

/**
 * Seedance 2.5 "Use the reference video as" — what a wired reference video is
 * FOR (`referenceTaskType`), on the Generate Video panel only.
 *
 * The node stores the person's choice and nothing else: Auto removes the key
 * (it is never stored as a string), and choosing Edit or Extend never rewrites
 * the stored aspect ratio or length — the server resolves the declaration
 * (`resolveSeedanceTaskType`, @nodaro/shared) and coerces both, so switching
 * back to Auto shows the stored values again. The panel only disables the
 * controls the run's declaration decides ({@link seedanceTaskTypePanelState})
 * and says why, in one line under the select.
 *
 * Shown only when it can do something: the model takes a task type (a catalog
 * capability) and a reference video is wired. Disconnecting the last clip
 * hides it without clearing the stored value (reconnecting restores it; the
 * server drops a declaration with no reference video). While Draft is on it is
 * disabled, also without clearing: a draft never carries the field.
 */

/** The select's value for "declare nothing" — never written to node data. */
const AUTO = "auto"

/** The choices, in order; Auto first. */
const CHOICES: ReadonlyArray<{ value: typeof AUTO | DeclaredSeedanceTaskType; labelKey: MessageKey }> = [
  { value: AUTO, labelKey: "vidcfg.seedanceTaskTypeAuto" },
  { value: "reference", labelKey: "vidcfg.seedanceTaskTypeReference" },
  { value: "edit", labelKey: "vidcfg.seedanceTaskTypeEdit" },
  { value: "extend", labelKey: "vidcfg.seedanceTaskTypeExtend" },
]

/** The provider-change fail-safe lives with the editor's other task-type rules (src/lib may not import a component). */
export { hasStaleSeedanceTaskType } from "@/lib/seedance-task-type"

/** The one line under the select: what the declaration keeps, or why Edit does not apply. */
export type SeedanceTaskTypeNote = "edit" | "extend" | "edit-not-applied"

/** What the panel locks and says for the node's task type. */
export interface SeedanceTaskTypePanelState {
  /** Edit locks the aspect ratio and the length; Extend the aspect ratio. */
  readonly lock: "edit" | "extend" | undefined
  readonly note: SeedanceTaskTypeNote | undefined
}

/**
 * The locks follow the RUN, not the selection: a control is locked only while
 * the run declares Edit or Extend (`asRun`, from `seedanceTaskTypeAsRun` — the
 * answer the node's price reads, so a clip of unknown length locks, as it is
 * priced). When Edit is chosen with a reference video wired and Draft off but
 * the run does not declare it (a clip the editor knows is outside the edit
 * window), the controls stay editable and the note says why. Without a
 * reference video, or with Draft on, the run uses the stored values and
 * nothing is said.
 */
export function seedanceTaskTypePanelState(args: {
  readonly provider: string | undefined
  readonly value: unknown
  readonly hasReferenceVideo: boolean
  readonly draft: unknown
  readonly asRun: SeedanceTaskTypeAsRun
}): SeedanceTaskTypePanelState {
  const { provider, asRun } = args
  if (!args.hasReferenceVideo) return { lock: undefined, note: undefined }
  if (asRun.taskType === "edit" || asRun.taskType === "extend") return { lock: asRun.taskType, note: asRun.taskType }
  const editNotApplied = listedSeedanceTaskType(provider, args.value) === "edit" && !isSeedanceDraftOn(provider, args.draft)
  return { lock: undefined, note: editNotApplied ? "edit-not-applied" : undefined }
}

export function SeedanceTaskTypeSelect({
  provider,
  value,
  draft,
  hasReferenceVideo,
  note,
  onUpdate,
}: {
  provider: string | undefined
  value: unknown
  /** The node's Draft toggle: while it is on, the select is disabled. */
  draft?: unknown
  hasReferenceVideo: boolean
  /** The one line shown under the select ({@link seedanceTaskTypePanelState}). */
  note?: SeedanceTaskTypeNote
  onUpdate: (patch: { referenceTaskType: DeclaredSeedanceTaskType | undefined }) => void
}) {
  const t = useT()
  if (!supportsReferenceTaskType(provider) || !hasReferenceVideo) return null
  const selected = listedSeedanceTaskType(provider, value) ?? AUTO
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{t("vidcfg.seedanceTaskType")}</Label>
      <Select
        value={selected}
        onValueChange={(v) => onUpdate({ referenceTaskType: v === AUTO ? undefined : listedSeedanceTaskType(provider, v) })}
        disabled={isSeedanceDraftOn(provider, draft)}
      >
        <SelectTrigger className="h-8 text-xs" aria-label={t("vidcfg.seedanceTaskType")}><SelectValue /></SelectTrigger>
        <SelectContent>
          {CHOICES.filter((c) => c.value === AUTO || listedSeedanceTaskType(provider, c.value) !== undefined).map((c) => (
            <SelectItem key={c.value} value={c.value}>{t(c.labelKey)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {note && <p className="text-[11px] text-muted-foreground px-1">{noteText(note, t)}</p>}
    </div>
  )
}

function noteText(note: SeedanceTaskTypeNote, t: ReturnType<typeof useT>): string {
  if (note === "edit") return t("vidcfg.seedanceTaskTypeEditLocked")
  if (note === "extend") return t("vidcfg.seedanceTaskTypeExtendLocked")
  return t("vidcfg.seedanceTaskTypeEditNotApplied", { min: SEEDANCE_EDIT_REF_VIDEO_SEC.min, max: SEEDANCE_EDIT_REF_VIDEO_SEC.max })
}

/**
 * The Duration control's line while Extend holds with Duration on Auto: the
 * length that runs (`seconds`, the as-run length — the model's own default).
 */
export function SeedanceExtendAutoLengthHint({ seconds }: { seconds: number }) {
  const t = useT()
  return <p className="text-[11px] text-muted-foreground">{t("vidcfg.seedanceTaskTypeExtendAutoLength", { seconds })}</p>
}
