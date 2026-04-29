import { useState } from "react"
import { Link } from "react-router-dom"
import { Check, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { NodaroLogo } from "@/components/nodaro-logo"
import { ThemeToggle } from "@/components/theme-toggle"

const MCP_URL = "https://mcp.nodaro.ai/mcp"

export default function McpPage() {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(MCP_URL)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
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
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Nodaro × MCP</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Drive Nodaro tools from Claude.ai, Cursor, Cline, Continue.dev, Goose,
          or any MCP-compatible AI client.
        </p>

        <div className="mt-8 inline-flex items-center gap-2 rounded-lg border bg-card px-4 py-3 font-mono text-sm shadow-sm">
          <code className="select-all">{MCP_URL}</code>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleCopy}
            aria-label="Copy MCP URL to clipboard"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>

        <p className="mt-6 text-sm text-muted-foreground">
          Paste into your MCP client's "Add custom connector" dialog. Sign in with
          your Nodaro account, consent, and start generating.
        </p>

        <a
          href="/docs/mcp"
          className="mt-8 inline-block underline text-sm"
        >
          Read the docs →
        </a>
      </main>
    </div>
  )
}
