"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2, Plus, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PlatformCard } from "@/components/integrations/platform-card"
import { ComingSoonCard } from "@/components/integrations/coming-soon-card"
import { NodaroCloudCard } from "@/components/integrations/nodaro-cloud-card"
import { ModelProvidersCard } from "@/components/integrations/model-providers-card"
import { CredentialsCard } from "@/components/integrations/credentials-card"
import { HeygenCatalogCard } from "@/components/integrations/heygen-catalog-card"
import { TelegramAccountsCard } from "@/components/integrations/telegram-accounts/telegram-accounts-card"
import {
  useIntegrationFilter,
  INTEGRATION_TABS,
  type IntegrationTab,
} from "@/components/integrations/use-integration-filter"
import { useT } from "@/lib/i18n"
import { getSocialConnections, getSocialProviders, type SocialProviderInfo } from "@/lib/api"
import { isCloud } from "@/lib/edition"
import type { SocialConnection } from "@/types/nodes"

/**
 * The grid derives ENTIRELY from GET /v1/social/providers — a network added
 * to the backend registry appears here with zero frontend changes, files
 * itself under the right tab from its own `category`, and shows its setup
 * requirements when this deployment cannot offer it yet (show-don't-hide, so
 * self-hosters discover what is possible).
 *
 * This file is layout. The filtering lives in `useIntegrationFilter`, where it
 * can be tested without rendering twenty cards.
 */
// `as const` keeps the values as literal keys, which is what `t()` accepts —
// widened to `string` it would compile away the guarantee that each one exists.
const TAB_LABELS = {
  all: "integ.tabAll",
  connected: "integ.tabConnected",
  social: "integ.tabSocial",
  publishing: "integ.tabPublishing",
} as const satisfies Record<IntegrationTab, string>

export default function IntegrationsPage() {
  const t = useT()
  const [providers, setProviders] = useState<SocialProviderInfo[]>([])
  const [connections, setConnections] = useState<SocialConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<IntegrationTab>("all")
  const [query, setQuery] = useState("")
  const [addCredentialOpen, setAddCredentialOpen] = useState(false)

  const loadConnections = useCallback(async () => {
    try {
      const data = await getSocialConnections()
      setConnections(data.connections)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    Promise.allSettled([
      getSocialProviders().then((data) => setProviders(data.providers)),
      loadConnections(),
    ]).finally(() => setLoading(false))
  }, [loadConnections])

  const { available, comingSoon, connectedCount, availableCount, isEmpty } = useIntegrationFilter(
    providers,
    connections,
    tab,
    query,
  )

  const sectionLabel = tab === "all" ? t("integ.sectionAll") : t(TAB_LABELS[tab])

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-6 flex flex-col gap-5">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[30px] font-extrabold tracking-[-0.035em]" style={{ color: "var(--integ-fg)" }}>
              {t("nav.integrations")}
            </h1>
            <p className="max-w-[560px] text-sm text-pretty" style={{ color: "var(--integ-muted)" }}>
              {isCloud() ? t("integ.subtitle") : t("integ.subtitleSelfHosted")}
            </p>
          </div>

          <div className="flex w-full items-center gap-2.5 sm:w-auto">
            <div
              className="flex h-9 flex-1 items-center gap-2 rounded-[10px] border px-3 sm:flex-none"
              style={{ borderColor: "var(--integ-line)", background: "var(--integ-surface)" }}
            >
              <Search className="h-3.5 w-3.5 flex-none" style={{ color: "var(--integ-muted)" }} aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("integ.search")}
                aria-label={t("integ.search")}
                className="w-full min-w-0 bg-transparent text-[13.5px] outline-none sm:w-[170px]"
                style={{ color: "var(--integ-fg)" }}
              />
              {query !== "" && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label={t("integ.clearSearch")}
                  className="flex-none rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <X className="h-3 w-3" style={{ color: "var(--integ-muted)" }} />
                </button>
              )}
            </div>
            {/* The page's ONE primary action, and the only thing here you
                create rather than connect. It opens the credentials card's own
                dialog — there is no second copy of that flow. */}
            <Button className="h-9 shrink-0 gap-1.5 font-bold" onClick={() => setAddCredentialOpen(true)}>
              <Plus className="h-4 w-4" />
              {t("creds.add")}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div
            className="flex gap-1.5 rounded-[11px] p-1"
            role="tablist"
            aria-label={t("nav.integrations")}
            style={{ background: "var(--integ-raised)" }}
          >
            {INTEGRATION_TABS.map((id) => {
              const active = tab === id
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(id)}
                  className="h-[30px] rounded-lg px-3.5 text-[12.5px] font-semibold transition-colors"
                  style={
                    active
                      ? { background: "var(--integ-surface)", color: "var(--integ-fg)", boxShadow: "0 1px 3px rgba(20,18,26,0.12)" }
                      : { color: "var(--integ-muted)" }
                  }
                >
                  {t(TAB_LABELS[id])}
                </button>
              )
            })}
          </div>

          {/* Describes the deployment, not the filtered view — so it does not
              move when you type in the search box beside it. */}
          <div className="flex items-center gap-2 text-[12.5px]" style={{ color: "var(--integ-muted)" }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--integ-ok)" }} aria-hidden />
            <span>{t("integ.countConnected", { n: connectedCount })}</span>
            <span aria-hidden style={{ color: "var(--integ-line)" }}>·</span>
            <span>{t("integ.countAvailable", { n: availableCount })}</span>
          </div>
        </div>
      </header>

      {/* Deliberately OUTSIDE the social-providers loading gate — each runs its
          own status fetch. NodaroCloud and ModelProviders render null on cloud;
          on a self-hosted install they are how this box reaches any model at
          all, which is why the cloud-drawn handoff does not show them. */}
      <div className="mb-6 flex flex-col gap-4">
        <NodaroCloudCard />
        <ModelProvidersCard />
        {/* Flex, not a two-track grid: HeygenCatalogCard hides ITSELF from
            anyone the server would refuse, and a grid would keep holding its
            column open — leaving the credentials card squeezed into 55% of the
            row beside a blank space. With flex, an absent child takes no room
            and the remaining card fills the width. */}
        {/* items-start, not stretch: the HeyGen panel pins its button to the
            bottom, so matching it to the credentials card's height opens a
            void that grows with every credential added. */}
        <div className="flex flex-wrap items-start gap-4 [&>section]:min-w-[320px] [&>section]:flex-1 [&>section:first-child]:grow-[1.35]">
          <CredentialsCard addOpen={addCredentialOpen} onAddOpenChange={setAddCredentialOpen} />
          <HeygenCatalogCard />
        </div>
        {/* Renders nothing until the server says this caller has the feature
            (Cloud, the private plugin loaded, and — before general
            availability — the preview audience), so no card flashes in and out. */}
        <TelegramAccountsCard />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {available.length > 0 && (
            <section className="flex flex-col gap-4">
              <SectionRule label={sectionLabel} />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {available.map(({ provider, connections: own }) => (
                  <PlatformCard
                    key={provider.id}
                    provider={provider}
                    connections={own}
                    onConnectionChange={loadConnections}
                  />
                ))}
              </div>
            </section>
          )}

          {comingSoon.length > 0 && (
            <section className="flex flex-col gap-4">
              <SectionRule
                label={isCloud() ? t("integ.comingSoon") : t("integ.requiresSetup")}
                count={comingSoon.length}
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {comingSoon.map((provider) => (
                  <ComingSoonCard key={provider.id} provider={provider} />
                ))}
              </div>
            </section>
          )}

          {isEmpty && (
            <p className="py-12 text-center text-sm" style={{ color: "var(--integ-muted)" }}>
              {t("integ.noMatches", { query: query.trim() })}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function SectionRule({ label, count }: { readonly label: string; readonly count?: number }) {
  const hasCount = typeof count === "number"
  return (
    <div className="flex items-center gap-3">
      <span
        className="text-[11px] font-bold uppercase tracking-[0.12em]"
        style={{ color: "var(--integ-muted)" }}
      >
        {label}
      </span>
      {hasCount && (
        <span
          className="rounded-full px-1.5 py-0.5 text-[11px] font-bold"
          style={{ background: "var(--integ-raised)", color: "var(--integ-muted)" }}
        >
          {count}
        </span>
      )}
      <div className="h-px flex-1" style={{ background: "var(--integ-line-soft)" }} />
    </div>
  )
}
