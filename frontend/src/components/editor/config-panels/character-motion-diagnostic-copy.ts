import { CHARACTER_MOTION_MAX_PICKS, getCharacterMotion, type CharacterMotionBindings, type CharacterMotionDiagnostic } from "@nodaro/prompts"
import type { TFunction } from "@/lib/i18n"

/** Localize explanation text without translating the authored prompt/requirements. */
export function formatCharacterMotionDiagnostic(
  item: CharacterMotionDiagnostic,
  bindings: CharacterMotionBindings,
  t: TFunction,
  label: (id: string) => string,
): string {
  const id = item.ids[0] ?? ""
  const entry = getCharacterMotion(id)
  const motion = label(id)
  const before = motion, after = label(item.ids[1] ?? "")
  switch (item.code) {
    case "capacity": return t("motionReview.diagnostic.capacity", { max: CHARACTER_MOTION_MAX_PICKS })
    case "unknown": return t("motionReview.diagnostic.unknown", { motion: id })
    case "omitted": return t(item.severity === "error" ? "motionReview.diagnostic.omittedAll" : "motionReview.diagnostic.omitted", { motions: item.ids.map(label).join(t("common.listComma")) })
    case "multiple-targets": return t("motionReview.diagnostic.multipleTargets")
    case "roles": return t("motionReview.diagnostic.roles")
    case "retired": return [t("motionReview.diagnostic.retired", { motion }), entry?.replacementId ? t("motionReview.diagnostic.replacement", { motion: label(entry.replacementId) }) : ""].filter(Boolean).join(t("common.fragmentGap"))
    case "pace": return t("motionReview.diagnostic.pace", { motion })
    case "requirements": return [
      t("motionReview.diagnostic.requirements", { motion, requirements: entry?.requires?.join(", ") ?? "" }),
      entry?.twoPerson || entry?.counterpart
        ? bindings.partnerNames?.length ? t("motionReview.diagnostic.partnerReference", { names: bindings.partnerNames.join(t("common.listComma")) }) : t("motionReview.diagnostic.partnerFallback")
        : t("motionReview.diagnostic.sceneRequirements"),
    ].join(t("common.fragmentGap"))
    case "visibility": return t("motionReview.diagnostic.visibility", { before, after })
    case "pose": return t("motionReview.diagnostic.pose", {
      before, after,
      fromPose: t(`motionReview.diagnostic.${entry?.endPose ?? "any"}`),
      toPose: t(`motionReview.diagnostic.${getCharacterMotion(item.ids[1] ?? "")?.startPose ?? "any"}`),
    })
    case "hands": return t("motionReview.diagnostic.hands", { before, after })
    case "compound": return t("motionReview.diagnostic.compound", { count: item.ids.length })
  }
  const unsupported: never = item.code
  return unsupported
}
