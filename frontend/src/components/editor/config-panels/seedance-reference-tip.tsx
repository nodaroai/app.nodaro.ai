import { isSeedance2Provider, isMinimaxH3Provider } from "@nodaro/shared"
import { useT } from "@/lib/i18n"

/**
 * Inline doctrine hint under the injected-references list, shown for the
 * ordinal-referenced multimodal providers (Seedance 2.x + MiniMax Hailuo 3):
 * reference ORDER is priority, identity refs should be a headshot + full-body
 * pair (multi-view sheets cause identity drift).
 * Guidance only — never blocks or validates (no-false-positive rule).
 */
// `provider` is `unknown`-tolerant so loosely-typed node data (index-signature
// shapes like SpeechToVideoData) can pass `data.provider` without casts.
export function SeedanceReferenceTip({ provider }: { provider?: unknown }) {
  const t = useT()
  if (typeof provider !== "string" || !(isSeedance2Provider(provider) || isMinimaxH3Provider(provider))) return null
  return (
    <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
      {t("cfgext.seedTipLead")}{" "}
      <span className="font-medium">{t("cfgext.seedTipEmph")}</span>
      {t("cfgext.seedTipRest")}
    </p>
  )
}
