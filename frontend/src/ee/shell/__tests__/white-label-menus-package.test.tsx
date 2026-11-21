import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { QueryClient } from "@tanstack/react-query"
import type { ComponentType } from "react"
import { WHITE_LABEL_WORLD_PATHS } from "../site"
import { WHITE_LABEL_MENU_PAGES, WHITE_LABEL_MENU_PAGES_NEVER_NAMED, whiteLabelWorldMenus } from "../white-label"
import type { SiteHeaderProps, SiteHeaderTranslate } from "../types"

/**
 * The pages below a world that the white-label header's menus open
 * (@nodaroai/shell ≥ 0.24.7: a white-label header draws such a page only where
 * the host names it), held to the pinned package:
 *
 *   - every page the package lists for a world this header draws is decided:
 *     one the app names by its rule (`WHITE_LABEL_MENU_PAGES`) or one it never
 *     names (`WHITE_LABEL_MENU_PAGES_NEVER_NAMED`), never both, and no other —
 *     a new page in the package fails here until it is decided;
 *   - the real header, given what the app passes, draws Video's Translate
 *     where the viewer is offered it and nothing of it otherwise, never draws
 *     Video's Editor, and its menu names the deployment, never Nodaro.
 *
 * Runs wherever the package is installed — the shared-header contract job
 * installs it and sets SHARED_HEADER_TESTS_REQUIRE_PACKAGE=1, under which a
 * missing package fails instead of skipping. Public CI has no package, so
 * there it skips.
 */

const env = vi.hoisted(() => ({
  // Built from fragments: a computed specifier keeps Vite from resolving it where it is absent.
  specifier: ["@nodaroai", "shell"].join("/"),
  require: process.env.SHARED_HEADER_TESTS_REQUIRE_PACKAGE === "1",
}))

interface PackageRoot {
  readonly NodaroShell: ComponentType<SiteHeaderProps>
  readonly shellTranslator: (locale: string | undefined) => SiteHeaderTranslate
  readonly WORLD_MENU_PAGES: Readonly<Record<string, readonly string[]>>
}

let pkg: PackageRoot | null = null
try {
  pkg = (await import(/* @vite-ignore */ env.specifier)) as PackageRoot
} catch (error) {
  if (env.require) throw error
}

const BRAND = "Acme Studio"
const WIDTH = 1440

function fakeSupabase() {
  const session = { user: { id: "u1" }, access_token: "access", refresh_token: "refresh" }
  return {
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signOut: async () => ({ error: null }),
    },
  }
}

/** One video model the platform lists: the menu adds its own rows (Translate's) only beside the platform's. */
const VIDEO_MODELS = {
  sections: [
    {
      kind: "video",
      families: [
        {
          family: "Acme Motion",
          models: [{ id: "acme-motion", label: "Acme Motion", description: "Text to video", modes: ["t2v"], useCases: [], maker: { name: "Acme" } }],
        },
      ],
    },
  ],
  recommendations: [],
  totalModels: 1,
}

function mount(worldMenus: SiteHeaderProps["worldMenus"]) {
  const sdk = {
    credits: { balance: async () => ({ subscription: 0, topup: 0, total: 0, tier: "free", effectiveTier: "free", dailySpent: 0, dailyLimit: null, monthlyAllocation: 0 }), claimSignupGrant: async () => ({ state: "granted", granted: false }) },
    billing: { plans: async () => ({ data: [], topUps: [], topUpRange: { min: 0, max: 0, currency: "USD" } }) },
    me: async () => ({ id: "u1", email: "ada@example.com", displayName: null, avatarUrl: null, tier: "free", isAdmin: false }),
    connectedApps: async () => [],
    models: { list: async () => VIDEO_MODELS },
    request: async () => ({}),
  }
  const Shell = pkg!.NodaroShell
  render(
    <Shell
      sdk={sdk as unknown as SiteHeaderProps["sdk"]}
      supabase={fakeSupabase() as never}
      queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      sourceApp="app"
      activeWorld="app"
      whiteLabel
      brandName={BRAND}
      worlds={["video", "app"]}
      worldHrefs={WHITE_LABEL_WORLD_PATHS}
      {...(worldMenus ? { worldMenus } : {})}
      urls={{ app: window.location.origin, login: "/login", home: "/" }}
      homeUrl="/"
      t={pkg!.shellTranslator("en")}
      selfServe={false}
      cookieDomain={null}
      claimSignupGrant={false}
      welcomeOfferAutoOpen={false}
      accountPages="in-app"
    />,
  )
}

const bar = () => document.querySelector("[data-ns-desktop-only]") as HTMLElement

async function openVideoMenu() {
  // A world's tab is one link; Down on it opens its menu (the package has no menu button since 0.28.0).
  fireEvent.keyDown(await within(bar()).findByRole("link", { name: /^Video/ }), { key: "ArrowDown" })
  const menu = await screen.findByRole("dialog", { name: "Video menu" })
  // Its categories are drawn once the platform's models are in.
  await within(menu).findAllByText("Acme Motion")
  return menu
}

/** The menu's Translate category, if it draws one. */
const translateCategory = (menu: HTMLElement) => menu.querySelector<HTMLElement>('[data-ns-category="translate"]')

/** The menu's Editor category (@nodaroai/shell ≥ 0.31), if it draws one. */
const editorCategory = (menu: HTMLElement) => menu.querySelector<HTMLElement>('[data-ns-category="editor"]')

beforeEach(() => {
  window.history.replaceState(null, "", "/projects")
  // A 1440 px desktop: every width query answers as such a window would.
  vi.stubGlobal("matchMedia", (query: string) => {
    const atLeast = /width\s*>=\s*(\d+)px/.exec(query)
    const below = /width\s*<\s*(\d+)px/.exec(query)
    const matches = atLeast ? WIDTH >= Number(atLeast[1]) : below ? WIDTH < Number(below[1]) : false
    return { matches, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe.skipIf(!pkg)("the white-label header's pages below a world, held to the pinned package", () => {
  it("every page the package lists for a world this header draws is named by the app's rule or never named, and no other", () => {
    for (const [world, pages] of Object.entries(pkg!.WORLD_MENU_PAGES)) {
      const mapped = Object.keys(WHITE_LABEL_MENU_PAGES[world as keyof typeof WHITE_LABEL_MENU_PAGES] ?? {})
      const never = [...(WHITE_LABEL_MENU_PAGES_NEVER_NAMED[world as keyof typeof WHITE_LABEL_MENU_PAGES_NEVER_NAMED] ?? [])]
      if (WHITE_LABEL_WORLD_PATHS[world as keyof typeof WHITE_LABEL_WORLD_PATHS] === undefined) {
        // A world this header never draws (Speech: no address on the site) decides nothing.
        expect(mapped, world).toEqual([])
        expect(never, world).toEqual([])
        continue
      }
      // Each page decided once: named by the rule, or never named.
      expect(mapped.filter((page) => never.includes(page)), world).toEqual([])
      expect([...mapped, ...never].sort(), world).toEqual([...pages].sort())
    }
    for (const world of [...Object.keys(WHITE_LABEL_MENU_PAGES), ...Object.keys(WHITE_LABEL_MENU_PAGES_NEVER_NAMED)]) {
      expect(Object.keys(pkg!.WORLD_MENU_PAGES)).toContain(world)
    }
  })

  it("dubbing offered: Video's menu draws Translate, opening the worlds app's page, made by the deployment", async () => {
    mount(whiteLabelWorldMenus(() => false))
    const menu = await openVideoMenu()
    const category = translateCategory(menu)
    expect(category?.textContent).toContain("Translate")
    fireEvent.focus(category!)
    // Its row (the preview names it too, from 1100 px) opens the worlds app's Translate page on this site.
    const named = await within(menu).findAllByText("Translate a video")
    const links = named.map((element) => element.closest("a")?.getAttribute("href")).filter(Boolean)
    expect(links).toEqual(["/video/translate"])
    // Editor is never named here, so never drawn, nor anything leading to it.
    expect(editorCategory(menu)).toBeNull()
    expect(menu.querySelector('a[href$="/editor"]')).toBeNull()
    expect(within(menu).getAllByText(BRAND).length).toBeGreaterThan(0)
    expect(menu.textContent).not.toMatch(/Nodaro/)
  })

  it("the Editor check sees the category: a white-label header that were told to name Editor would draw it", async () => {
    // A control for the assertions above — the app never passes this.
    mount({ video: { pages: ["translate", "editor"] as unknown as NonNullable<NonNullable<SiteHeaderProps["worldMenus"]>["video"]>["pages"] } })
    const menu = await openVideoMenu()
    expect(editorCategory(menu)).not.toBeNull()
  })

  it("dubbing withheld, or the viewer's answer not in yet: no Translate at all", async () => {
    for (const menus of [whiteLabelWorldMenus((type) => type === "dubbing"), whiteLabelWorldMenus(null)]) {
      mount(menus)
      const menu = await openVideoMenu()
      expect(translateCategory(menu)).toBeNull()
      expect(editorCategory(menu)).toBeNull()
      expect(within(menu).queryByText("Translate a video")).toBeNull()
      // Nor does a search find it.
      fireEvent.change(within(menu).getByRole("searchbox"), { target: { value: "translate" } })
      expect(within(menu).queryByText("Translate a video")).toBeNull()
      expect(menu.textContent).not.toMatch(/Nodaro/)
      cleanup()
    }
  })
})
