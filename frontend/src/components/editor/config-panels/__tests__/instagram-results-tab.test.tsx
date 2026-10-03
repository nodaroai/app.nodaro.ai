/**
 * Instagram's Results tab: the per-post AI analysis and the JSON used to be
 * readable only through the API, and the node spoke of "ads". It now shows the
 * analysis on an expanded post (the same view as Meta Ads — one analysis
 * shape), a JSON view with copy / download, and its own post wording.
 */
import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { render, screen, fireEvent } from "@testing-library/react"
import { InstagramScrapeConfig } from "../instagram-configs"
import { en } from "@/lib/i18n/en"
import type { InstagramScrapeNodeData } from "@/types/nodes"

vi.mock("@/components/editor/save-to-library-button", () => ({ SaveToLibraryButton: () => null }))
vi.mock("../llm-model-select", () => ({ LlmModelSelect: () => null }))

const POSTS = [
  {
    postId: "p1",
    ownerUsername: "nasa",
    caption: "Artemis rollout",
    analysis: {
      assetType: "static",
      format: "single image",
      summary: "A launch-pad hero shot.",
      visualHooks: ["Rocket at dawn"],
      audiences: ["Space fans"],
      graphicIdentity: "Clean white type",
      copywritingHooks: [],
      usps: [],
      cta: "",
    },
  },
  { postId: "p2", ownerUsername: "esa", caption: "Ariane 6", analysisSkipped: "deadline" },
]

function renderTab(generatedJson: unknown) {
  const data = { label: "Instagram", mode: "profile", targets: "nasa", generatedJson, lastRunOutcome: "success" } as unknown as InstagramScrapeNodeData
  return render(
    <InstagramScrapeConfig data={data} onUpdate={() => {}} sources={[]} fieldMappings={{}} onMapField={() => {}} nodes={[]} />,
  )
}

describe("Instagram Results tab", () => {
  it("shows an analysed post's AI analysis when its row is opened", () => {
    renderTab(POSTS)
    fireEvent.click(screen.getByText("@nasa"))
    expect(screen.getByText("A launch-pad hero shot.")).toBeInTheDocument()
    expect(screen.getByText("· Rocket at dawn")).toBeInTheDocument()
  })

  it("says so for a post the run could not analyse", () => {
    renderTab(POSTS)
    fireEvent.click(screen.getByText("@esa"))
    expect(screen.getByText(en["cfgext.igAnalyzeSkipped"])).toBeInTheDocument()
  })

  it("has a JSON view of everything the run returned", () => {
    renderTab(POSTS)
    fireEvent.click(screen.getByText(en["cfgext.scrapeViewJson"]))
    expect(screen.getByText(/"summary": "A launch-pad hero shot\."/)).toBeInTheDocument()
  })
})

describe("Instagram speaks of posts, not ads", () => {
  // Meta Ads keys whose English names ads / ad copy / ad creatives.
  const AD_WORDED = [
    "metaAdsInHandle", "metaAdsOutText", "metaAdsOutImage", "metaAdsOutVideo", "metaAdsPrevAd", "metaAdsNextAd",
    "metaAdsFormat", "metaAdsFormatHint", "metaAdsFormatNoMatch", "metaAdsCopyAllVideosHint", "metaAdsAnalyzeSkipped",
    "metaAdsNoResults", "metaAdsCountHint",
  ]
  it.each(["../instagram-configs.tsx", "../../../nodes/instagram-scrape-node.tsx"])("%s uses none of the ad-worded keys", (file) => {
    const src = readFileSync(resolve(__dirname, file), "utf8")
    for (const key of AD_WORDED) expect(src, key).not.toContain(`"cfgext.${key}"`)
  })
})
