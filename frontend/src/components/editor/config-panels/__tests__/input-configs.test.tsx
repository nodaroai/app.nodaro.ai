import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { TextPromptConfig } from "../input-configs"

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}))

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: any) => <textarea {...props} />,
}))

vi.mock("@/components/editor/config-panels/tag-textarea", () => ({
  TagTextarea: ({ value, onChange, placeholder, className, rows }: any) => (
    <textarea
      value={value}
      onChange={(e: any) => onChange(e.target.value)}
      placeholder={placeholder}
      className={className}
      rows={rows}
    />
  ),
}))

vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}))

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}))

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => <span />,
}))

vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: (props: any) => <img src={props.src} alt={props.alt} />,
}))

vi.mock("@/lib/api", () => ({
  uploadAudio: vi.fn(),
  fetchYouTubeOEmbed: vi.fn(),
  extractYouTubeAudioApi: vi.fn(),
  getJobStatus: vi.fn(),
  startVideoDownload: vi.fn(),
  subscribeToDownloadProgress: vi.fn(),
}))

vi.mock("lucide-react", () => ({
  X: () => <span data-testid="x-icon" />,
  Plus: () => <span data-testid="plus-icon" />,
  Loader2: () => <span data-testid="loader-icon" />,
  Check: () => <span data-testid="check-icon" />,
  Download: () => <span data-testid="download-icon" />,
  AlertCircle: () => <span data-testid="alert-icon" />,
  Sparkles: () => <span data-testid="sparkles-icon" />,
}))

function createDefaultProps(overrides: Record<string, unknown> = {}) {
  return {
    data: { label: "Text Prompt", text: "initial text", variables: {} },
    onUpdate: vi.fn(),
    sources: [],
    fieldMappings: {},
    onMapField: vi.fn(),
    nodes: [],
    ...overrides,
  } as any
}

describe("TextPromptConfig", () => {
  it("renders textarea with current text value", () => {
    render(<TextPromptConfig {...createDefaultProps()} />)
    const textarea = screen.getByPlaceholderText("Enter your story prompt...")
    expect(textarea).toHaveValue("initial text")
  })

  it("renders the Prompt Text label", () => {
    render(<TextPromptConfig {...createDefaultProps()} />)
    expect(screen.getByText("Prompt Text")).toBeInTheDocument()
  })

  it("calls onUpdate when textarea value changes", () => {
    const onUpdate = vi.fn()
    render(<TextPromptConfig {...createDefaultProps({ onUpdate })} />)
    const textarea = screen.getByPlaceholderText("Enter your story prompt...")
    fireEvent.change(textarea, { target: { value: "new prompt text" } })
    expect(onUpdate).toHaveBeenCalledWith({ text: "new prompt text" })
  })

  it("calls onUpdate with empty string when textarea is cleared", () => {
    const onUpdate = vi.fn()
    render(<TextPromptConfig {...createDefaultProps({ onUpdate })} />)
    const textarea = screen.getByPlaceholderText("Enter your story prompt...")
    fireEvent.change(textarea, { target: { value: "" } })
    expect(onUpdate).toHaveBeenCalledWith({ text: "" })
  })

  it("renders textarea with correct rows", () => {
    render(<TextPromptConfig {...createDefaultProps()} />)
    const textarea = screen.getByPlaceholderText("Enter your story prompt...")
    expect(textarea).toHaveAttribute("rows", "5")
  })

  it("renders with empty text data", () => {
    const props = createDefaultProps({
      data: { label: "Text Prompt", text: "", variables: {} },
    })
    render(<TextPromptConfig {...props} />)
    const textarea = screen.getByPlaceholderText("Enter your story prompt...")
    expect(textarea).toHaveValue("")
  })

  it("renders the Prompt Text label element", () => {
    render(<TextPromptConfig {...createDefaultProps()} />)
    const label = screen.getByText("Prompt Text")
    expect(label).toBeInTheDocument()
  })
})
