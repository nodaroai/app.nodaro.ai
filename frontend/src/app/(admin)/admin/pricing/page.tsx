"use client"

import { useState } from "react"
import {
  DollarSign,
  Video,
  Image,
  Music,
  Brain,
  Wrench,
  CreditCard,
  ShoppingCart,
  Zap,
  ChevronDown,
  ChevronRight,
  Search,
  Mic,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  QUICK_STATS,
  SUBSCRIPTION_TIERS,
  TOPUP_PACKAGES,
  VIDEO_MODELS,
  LIP_SYNC_MODELS,
  IMAGE_MODELS,
  AUDIO_MODELS,
  LLM_MODELS,
  FFMPEG_NODES,
  type ModelPricing,
  type LLMPricing,
} from "./pricing-data"

type ModelTab = "video" | "lip-sync" | "image" | "audio" | "llm"

const MODEL_TABS: readonly { readonly id: ModelTab; readonly label: string; readonly icon: typeof Video }[] = [
  { id: "video", label: "Video", icon: Video },
  { id: "lip-sync", label: "Lip Sync", icon: Mic },
  { id: "image", label: "Image", icon: Image },
  { id: "audio", label: "Audio / Music", icon: Music },
  { id: "llm", label: "LLM", icon: Brain },
] as const

function marginColor(margin: number | null): string {
  if (margin === null) return "text-zinc-400"
  if (margin > 40) return "text-green-600 dark:text-green-400"
  if (margin >= 25) return "text-yellow-600 dark:text-yellow-400"
  return "text-red-600 dark:text-red-400"
}

function filterModels(models: readonly ModelPricing[], query: string): readonly ModelPricing[] {
  if (!query.trim()) return models
  const q = query.toLowerCase()
  return models.filter(
    (m) => m.model.toLowerCase().includes(q) || m.variant.toLowerCase().includes(q),
  )
}

function filterLLMs(models: readonly LLMPricing[], query: string): readonly LLMPricing[] {
  if (!query.trim()) return models
  const q = query.toLowerCase()
  return models.filter((m) => m.model.toLowerCase().includes(q))
}

function QuickStatsCard() {
  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center">
          <Zap className="h-5 w-5 text-primary" />
        </div>
        <h2 className="text-sm font-semibold uppercase tracking-wider">Quick Stats</h2>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {QUICK_STATS.map((stat) => (
          <div key={stat.label} className="rounded-md bg-muted/40 px-3 py-2">
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className="text-sm font-medium mt-0.5">{stat.value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function SubscriptionTiersSection() {
  return (
    <div className="border rounded-lg bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b">
        <CreditCard className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold uppercase tracking-wider">Subscription Tiers</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Tier</th>
              <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Price/mo</th>
              <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Credits</th>
              <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">$/Credit</th>
              <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">LLM Requests</th>
              <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Our Cost</th>
              <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Margin</th>
              <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Notes</th>
            </tr>
          </thead>
          <tbody>
            {SUBSCRIPTION_TIERS.map((tier) => (
              <tr key={tier.name} className="border-t hover:bg-muted/30 transition-colors">
                <td className="px-4 py-2.5 font-medium">{tier.name}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{tier.price === 0 ? "$0" : `$${tier.price}`}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{tier.credits.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{tier.perCredit !== null ? `$${tier.perCredit.toFixed(3)}` : "--"}</td>
                <td className="px-4 py-2.5 text-xs">{tier.llmRequests}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">~${tier.estimatedCost}</td>
                <td className={`px-4 py-2.5 text-right font-mono text-xs font-semibold ${marginColor(tier.margin)}`}>
                  {tier.margin !== null ? `${tier.margin}%` : "loss leader"}
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{tier.notes ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TopUpSection() {
  return (
    <div className="border rounded-lg bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b">
        <ShoppingCart className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold uppercase tracking-wider">Top-Up Credits</h2>
        <span className="text-xs text-muted-foreground ml-2">Non-expiring (unlike subscription credits)</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Package</th>
              <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Price</th>
              <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Credits</th>
              <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">$/Credit</th>
            </tr>
          </thead>
          <tbody>
            {TOPUP_PACKAGES.map((pkg) => (
              <tr key={pkg.name} className="border-t hover:bg-muted/30 transition-colors">
                <td className="px-4 py-2.5 font-medium">{pkg.name}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">${pkg.price}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{pkg.credits}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">${pkg.perCredit.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ModelTable({ models, search }: { readonly models: readonly ModelPricing[]; readonly search: string }) {
  const filtered = filterModels(models, search)

  if (filtered.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        No models match &quot;{search}&quot;
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Model</th>
            <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Variant</th>
            <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Provider</th>
            <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Provider Cost</th>
            <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Credits</th>
            <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Notes</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((m, i) => (
            <tr key={`${m.model}-${m.variant}-${i}`} className="border-t hover:bg-muted/30 transition-colors">
              <td className="px-4 py-2.5 font-medium">{m.model}</td>
              <td className="px-4 py-2.5 text-xs text-muted-foreground">{m.variant}</td>
              <td className="px-4 py-2.5">
                <Badge variant="outline" className="text-xs font-normal">
                  {m.provider}
                </Badge>
              </td>
              <td className="px-4 py-2.5 text-right font-mono text-xs">{m.providerCost}</td>
              <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold">{m.credits}</td>
              <td className="px-4 py-2.5 text-xs text-muted-foreground">{m.notes ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function LLMTable({ search }: { readonly search: string }) {
  const filtered = filterLLMs(LLM_MODELS, search)

  if (filtered.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        No models match &quot;{search}&quot;
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Model</th>
            <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Input $/M tokens</th>
            <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Output $/M tokens</th>
            <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">~Cost / request</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((m) => (
            <tr key={m.model} className="border-t hover:bg-muted/30 transition-colors">
              <td className="px-4 py-2.5 font-medium">{m.model}</td>
              <td className="px-4 py-2.5 text-right font-mono text-xs">{m.inputCost}</td>
              <td className="px-4 py-2.5 text-right font-mono text-xs">{m.outputCost}</td>
              <td className="px-4 py-2.5 text-right font-mono text-xs">{m.perRequest}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function getModelsForTab(tab: ModelTab): readonly ModelPricing[] {
  switch (tab) {
    case "video": return VIDEO_MODELS
    case "lip-sync": return LIP_SYNC_MODELS
    case "image": return IMAGE_MODELS
    case "audio": return AUDIO_MODELS
    default: return []
  }
}

function AIModelsSection() {
  const [activeTab, setActiveTab] = useState<ModelTab>("video")
  const [search, setSearch] = useState("")

  return (
    <div className="border rounded-lg bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b">
        <DollarSign className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold uppercase tracking-wider">AI Model Pricing</h2>
      </div>

      {/* Tab bar + search */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 px-4 py-3 border-b bg-muted/20">
        <div className="flex flex-wrap gap-1">
          {MODEL_TABS.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  activeTab === tab.id
                    ? "bg-[#ff0073]/10 text-[#ff0073] border border-[#ff0073]/30"
                    : "text-muted-foreground hover:bg-muted/50 border border-transparent"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            )
          })}
        </div>
        <div className="relative sm:ml-auto w-full sm:w-56">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Filter models..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
      </div>

      {/* Table content */}
      {activeTab === "llm" ? (
        <>
          <LLMTable search={search} />
          <div className="px-4 py-2.5 text-xs text-muted-foreground border-t bg-muted/20">
            Included free in tier quota. After quota exhausted: 1 credit per request.
          </div>
        </>
      ) : (
        <ModelTable models={getModelsForTab(activeTab)} search={search} />
      )}
    </div>
  )
}

function FFmpegSection() {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="border rounded-lg bg-card overflow-hidden">
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-2 px-5 py-4 w-full text-left border-b hover:bg-muted/30 transition-colors"
      >
        <Wrench className="h-4 w-4 text-green-600 dark:text-green-400" />
        <h2 className="text-sm font-semibold uppercase tracking-wider">FFmpeg Post-Processing</h2>
        <Badge className="ml-2 bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 border-0">
          FREE
        </Badge>
        {expanded ? (
          <ChevronDown className="h-4 w-4 ml-auto text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 ml-auto text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Node</th>
                  <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Function</th>
                  <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Credits</th>
                </tr>
              </thead>
              <tbody>
                {FFMPEG_NODES.map((node) => (
                  <tr key={node.name} className="border-t hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5 font-medium">{node.name}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{node.description}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Badge className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 border-0 text-xs">
                        0
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 text-xs text-muted-foreground border-t bg-muted/20">
            These run FFmpeg on our server. No external API. Zero cost.
          </div>
        </>
      )}
    </div>
  )
}

export default function AdminPricingPage() {
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center">
          <DollarSign className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Pricing Overview</h1>
          <p className="text-sm text-muted-foreground">Model costs, credit pricing, and subscription tiers</p>
        </div>
      </div>

      {/* 1. Quick Stats */}
      <QuickStatsCard />

      {/* 2. Subscription Tiers */}
      <SubscriptionTiersSection />

      {/* 3. Top-Up Credits */}
      <TopUpSection />

      {/* 4. AI Model Pricing */}
      <AIModelsSection />

      {/* 5. FFmpeg Post-Processing */}
      <FFmpegSection />
    </div>
  )
}
