import { useEffect, useRef, useState } from "react"
import { isCloud } from "@/lib/edition"
import { Link } from "react-router-dom"
import { Check, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { NodaroLogo } from "@/components/nodaro-logo"
import { ThemeToggle } from "@/components/theme-toggle"
import { useT } from "@/lib/i18n"

// Cloud serves MCP from its own subdomain; a self-host serves it from the
// instance the user is already looking at. Handing a self-hoster the cloud URL
// pointed their agent at our SaaS instead of their server (community grind,
// 2026-08-13).
const MCP_URL = isCloud()
  ? "https://mcp.nodaro.ai/mcp"
  : `${window.location.origin}/mcp`

export default function McpPage() {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(MCP_URL)
      setCopied(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard permission denied or unavailable — silently no-op.
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <NodaroLogo />
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-16 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t("mcp.title")}</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          {t("mcp.subtitle")}
        </p>

        <div className="mt-8 inline-flex items-center gap-2 rounded-lg border bg-card px-4 py-3 font-mono text-sm shadow-sm">
          <code className="select-all">{MCP_URL}</code>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleCopy}
            aria-label={t("mcp.copyUrlAria")}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>

        <p className="mt-6 text-sm text-muted-foreground">
          {t("mcp.pasteHint")}
        </p>

        <a
          href="https://nodaroai.github.io/app.nodaro.ai/mcp/"
          className="mt-8 inline-block underline text-sm"
        >
          {t("mcp.readDocs")}
        </a>
      </main>
    </div>
  )
}
