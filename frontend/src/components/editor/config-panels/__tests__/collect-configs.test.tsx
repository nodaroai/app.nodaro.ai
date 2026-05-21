import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { CollectConfig } from "../collect-configs"
import type { CollectNodeData } from "@/types/nodes"

// ── Shadcn mocks ─────────────────────────────────────────────────────────────

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, htmlFor, ...props }: any) => (
    <label htmlFor={htmlFor} {...props}>
      {children}
    </label>
  ),
}))

vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}))

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: any) => <textarea {...props} />,
}))

vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange, ...props }: any) => (
    <input
      type="checkbox"
      checked={!!checked}
      onChange={(e: any) => onCheckedChange?.(e.target.checked)}
      {...props}
    />
  ),
}))

// Select mock: flatten options under a native <select> so we can drive it
// with fireEvent.change. SelectTrigger's children include SelectValue, which
// we ignore. role="combobox" mirrors Radix's a11y exposure.
vi.mock("@/components/ui/select", () => {
  const React = require("react")
  return {
    Select: ({ children, value, onValueChange }: any) => {
      const items: any[] = []
      React.Children.forEach(children, (child: any) => {
        if (!child) return
        if (child.type?.displayName === "SelectContent" || child.props?.__content) {
          React.Children.forEach(child.props?.children, (item: any) => {
            if (item) items.push(item)
          })
        }
      })
      return (
        <select
          role="combobox"
          value={value ?? ""}
          onChange={(e: any) => onValueChange?.(e.target.value)}
        >
          {items}
        </select>
      )
    },
    SelectContent: Object.assign(({ children }: any) => <>{children}</>, {
      displayName: "SelectContent",
    }),
    SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
    SelectTrigger: Object.assign(
      ({ children }: any) => <>{children}</>,
      { displayName: "SelectTrigger" },
    ),
    SelectValue: () => null,
  }
})

vi.mock("@/components/ui/tabs", () => {
  const React = require("react")
  return {
    Tabs: ({ children, defaultValue }: any) => {
      const [active, setActive] = React.useState(defaultValue)
      return (
        <div data-active-tab={active}>
          {React.Children.map(children, (c: any) =>
            React.isValidElement(c) ? React.cloneElement(c, { __active: active, __setActive: setActive }) : c,
          )}
        </div>
      )
    },
    TabsList: ({ children, __active, __setActive }: any) => (
      <div role="tablist">
        {React.Children.map(children, (c: any) =>
          React.isValidElement(c) ? React.cloneElement(c, { __active, __setActive }) : c,
        )}
      </div>
    ),
    TabsTrigger: ({ children, value, disabled, __active, __setActive }: any) => (
      <button
        role="tab"
        aria-selected={__active === value}
        disabled={disabled}
        data-disabled={disabled ? "" : undefined}
        onClick={() => !disabled && __setActive?.(value)}
      >
        {children}
      </button>
    ),
    TabsContent: ({ children, value, __active }: any) =>
      __active === value ? <div role="tabpanel">{children}</div> : null,
  }
})

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeData(overrides: Partial<CollectNodeData> = {}): CollectNodeData {
  return {
    label: "Collect",
    strategyId: "concat",
    strategyConfig: { separator: "\n\n" },
    ...overrides,
  } as CollectNodeData
}

const baseProps = {
  sources: [],
  fieldMappings: {},
  onMapField: vi.fn(),
  nodes: [],
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("CollectConfig", () => {
  it("renders strategy picker with all 6 strategies", () => {
    render(<CollectConfig {...baseProps} data={makeData()} onUpdate={vi.fn()} />)
    expect(screen.getByText(/Pick best/i)).toBeInTheDocument()
    expect(screen.getByText(/Concatenate/i)).toBeInTheDocument()
    expect(screen.getByText(/First non-empty/i)).toBeInTheDocument()
    expect(screen.getByText(/Count/i)).toBeInTheDocument()
    expect(screen.getByText(/Majority vote/i)).toBeInTheDocument()
    expect(screen.getByText(/Merge JSON/i)).toBeInTheDocument()
  })

  it("renders Tabs with Config + Inputs", () => {
    render(<CollectConfig {...baseProps} data={makeData()} onUpdate={vi.fn()} />)
    expect(screen.getByRole("tab", { name: /config/i })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /inputs/i })).toBeInTheDocument()
  })

  it("Inputs tab disabled when node hasn't run", () => {
    render(<CollectConfig {...baseProps} data={makeData({ executionStatus: "idle" })} onUpdate={vi.fn()} />)
    const tab = screen.getByRole("tab", { name: /inputs/i })
    expect(tab).toHaveAttribute("data-disabled")
  })

  it("Inputs tab enabled when node has completed with a result", () => {
    render(
      <CollectConfig
        {...baseProps}
        data={makeData({ executionStatus: "completed", result: "merged output" })}
        onUpdate={vi.fn()}
      />,
    )
    const tab = screen.getByRole("tab", { name: /inputs/i })
    expect(tab).not.toHaveAttribute("data-disabled")
  })

  it("calls onUpdate with default config when strategy changes", () => {
    const onUpdate = vi.fn()
    render(<CollectConfig {...baseProps} data={makeData()} onUpdate={onUpdate} />)
    const select = screen.getByRole("combobox")
    fireEvent.change(select, { target: { value: "vote" } })
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        strategyId: "vote",
        strategyConfig: expect.objectContaining({ caseSensitive: false }),
      }),
    )
  })

  it("renders Separator input for concat strategy", () => {
    render(<CollectConfig {...baseProps} data={makeData({ strategyId: "concat", strategyConfig: { separator: "-" } })} onUpdate={vi.fn()} />)
    const input = screen.getByDisplayValue("-")
    expect(input).toBeInTheDocument()
  })

  it("renders Criteria textarea for pick-best-llm strategy", () => {
    render(
      <CollectConfig
        {...baseProps}
        data={makeData({
          strategyId: "pick-best-llm",
          strategyConfig: { criteria: "best one", inputKind: "text" },
        })}
        onUpdate={vi.fn()}
      />,
    )
    expect(screen.getByDisplayValue("best one")).toBeInTheDocument()
  })

  it("renders Case-sensitive switch for vote strategy", () => {
    render(
      <CollectConfig
        {...baseProps}
        data={makeData({ strategyId: "vote", strategyConfig: { caseSensitive: false } })}
        onUpdate={vi.fn()}
      />,
    )
    expect(screen.getByText(/Case-sensitive/i)).toBeInTheDocument()
  })

  it("renders deep/shallow select for merge-json strategy", () => {
    render(
      <CollectConfig
        {...baseProps}
        data={makeData({ strategyId: "merge-json", strategyConfig: { strategy: "deep" } })}
        onUpdate={vi.fn()}
      />,
    )
    // "Deep merge" appears both in the <option> and in the helper text;
    // use getAllByText so we don't fight the helper.
    expect(screen.getAllByText(/Deep merge/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/Shallow merge/i)).toBeInTheDocument()
  })

  it("renders 'No configuration' for first-non-empty strategy", () => {
    render(
      <CollectConfig
        {...baseProps}
        data={makeData({ strategyId: "first-non-empty", strategyConfig: {} })}
        onUpdate={vi.fn()}
      />,
    )
    expect(screen.getByText(/No configuration/i)).toBeInTheDocument()
  })

  it("renders 'No configuration' for count strategy", () => {
    render(
      <CollectConfig
        {...baseProps}
        data={makeData({ strategyId: "count", strategyConfig: {} })}
        onUpdate={vi.fn()}
      />,
    )
    expect(screen.getByText(/No configuration/i)).toBeInTheDocument()
  })
})
