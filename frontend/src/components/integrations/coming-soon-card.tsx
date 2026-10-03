import { useT } from "@/lib/i18n"
import { isCloud } from "@/lib/edition"
import type { SocialProviderInfo } from "@/lib/api"
import { BrandTile } from "./brand-tile"
import { describeProvider } from "./platform-meta"

/**
 * A network this deployment cannot connect yet — dashed, drained of brand,
 * and in its own section, so it never competes with what you can connect now.
 *
 * The two editions mean genuinely different things by "unavailable", and the
 * card says which:
 *
 *  - On cloud the user cannot set deployment env vars, so the network is
 *    simply not offered yet. "Coming soon", and the deployment internals stay
 *    out of the UI.
 *  - Self-hosted, the reader IS the deployment owner, so the missing env var
 *    NAMES are the setup guide rather than noise. Show-don't-hide: a
 *    self-hoster discovers what is possible by seeing it listed.
 *
 * The handoff puts a "Notify me" button here. There is nothing behind it, and
 * a button that does nothing is worse than no button, so it is left out.
 */
interface ComingSoonCardProps {
  readonly provider: SocialProviderInfo
}

export function ComingSoonCard({ provider }: ComingSoonCardProps) {
  const t = useT()
  const cloud = isCloud()
  const missing = provider.missingEnv ?? []

  return (
    <div
      className="flex flex-col gap-2.5 rounded-[14px] border border-dashed p-4"
      style={{ borderColor: "var(--integ-line-dashed)", background: "var(--integ-soon-card)" }}
    >
      <div className="flex items-start gap-2.5">
        <BrandTile platformId={provider.id} label={provider.label} muted size="sm" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span
            className="text-[13.5px] font-bold tracking-[-0.01em] text-pretty"
            style={{ color: "var(--integ-muted)" }}
          >
            {provider.label}
          </span>
          <span className="text-[11.5px] leading-[1.4] text-pretty" style={{ color: "var(--integ-muted)" }}>
            {describeProvider(provider, t)}
          </span>
        </div>
      </div>

      {cloud ? (
        <span
          className="rounded-[9px] border px-2 py-1 text-center text-[11px] font-semibold"
          style={{ borderColor: "var(--integ-line-dashed)", color: "var(--integ-muted)" }}
        >
          {t("dash.comingSoon")}
        </span>
      ) : (
        <div className="flex flex-col gap-1">
          <span
            className="rounded-[9px] border px-2 py-1 text-center text-[11px] font-semibold"
            style={{ borderColor: "var(--integ-line-dashed)", color: "var(--integ-muted)" }}
            title={missing.length > 0 ? t("integ.missing", { env: missing.join(", ") }) : undefined}
          >
            {t("integ.requiresSetup")}
          </span>
          {missing.length > 0 && (
            <p className="text-[10.5px] leading-[1.4]" style={{ color: "var(--integ-muted)" }}>
              {t("integ.setToEnablePre")}
              <code className="font-mono break-all">{missing.join(", ")}</code>
              {t("integ.setToEnablePost")}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
