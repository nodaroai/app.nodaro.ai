import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, it, expect, vi } from "vitest"

// The card renders the real useMediaUpload → useAuth chain, which calls
// supabase createClient(). CI has no VITE_SUPABASE_URL, so the real client
// throws in validateSupabaseUrl. Stub createClient with the auth surface
// useAuth.initAuth touches (getUser / onAuthStateChange / profiles lookup).
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>()
  const stubClient = {
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) }),
  }
  return { ...actual, createClient: (() => stubClient) as unknown as typeof actual.createClient }
})

import { ImageUploadCard } from "../image-upload-card"

const renderCard = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe("ImageUploadCard composer variant", () => {
  const base = {
    label: "Ad visual",
    nodeId: "n1",
    isFullscreen: true,
    onUpdateInput: vi.fn(),
  }

  it("renders a compact thumbnail + remove (not the full preview) when filled", () => {
    renderCard(
      <ImageUploadCard
        {...base}
        url="https://cdn.example/x.png"
        inputValues={{ n1: { url: "https://cdn.example/x.png" } }}
        variant="composer"
      />,
    )
    // The compact branch uses aria-label="Remove image"; the default branch uses title only.
    expect(screen.getByLabelText("Remove image")).toBeInTheDocument()
    expect(screen.getByText("Ad visual")).toBeInTheDocument()
  })

  it("renders a compact drop affordance when empty", () => {
    renderCard(<ImageUploadCard {...base} url={undefined} inputValues={{}} variant="composer" />)
    expect(screen.getByText("Add image")).toBeInTheDocument()
  })
})
