import { SubGateApprovalCard } from "./sub-gate-approval-card"
import { useT } from "@/lib/i18n"

interface Props {
  readonly pipelineId: string
  readonly previewUrl: string
}

/**
 * Phase 1C.2 — Stage 7 sub-gate `silent_cut_preview`.
 *
 * Renders a preview of the silent merged reel (no music, no Editor cut
 * decisions yet) so the user can sanity-check timing/order before the
 * pipeline spends credits on music gen + Editor LLM. The approve/reject
 * state machine + reject dialog live in `SubGateApprovalCard`; this
 * component contributes only the preview video block.
 */
export function SilentCutPreview({ pipelineId, previewUrl }: Props) {
  const t = useT()
  return (
    <SubGateApprovalCard
      pipelineId={pipelineId}
      gate="silent_cut_preview"
      title={t("pipe.silentPreviewTitle")}
      description={t("pipe.silentPreviewDesc")}
      approveLabel={t("pipe.approveContinueToMusic")}
      rejectTitle={t("pipe.rejectSilentPreview")}
      rejectPlaceholder={t("pipe.silentCutChangePlaceholder")}
      cardTestId="silent-cut-preview"
    >
      <video
        controls
        src={previewUrl}
        className="w-full rounded-md bg-black"
        data-testid="silent-cut-preview-video"
      />
    </SubGateApprovalCard>
  )
}
