import { describe, it, expect, vi } from "vitest"
import { render } from "@testing-library/react"
import { SelectorConfig } from "../selector-config"
import type { SelectorNodeData } from "@/types/nodes"
import type { FullSelectorMode } from "@nodaro/shared"

// ── Shadcn mocks ─────────────────────────────────────────────────────────────
// Mock UI primitives so snapshots are stable across shadcn / Radix internal
// markup changes. We expose just enough structure (data-* attrs, native form
// controls) for the snapshot to capture per-mode field composition.

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

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange, ...props }: any) => (
    <input
      type="checkbox"
      checked={!!checked}
      onChange={(e: any) => onCheckedChange?.(e.target.checked)}
      {...props}
    />
  ),
}))

// React Context-based mock so we don't leak internal props through React.cloneElement
// into the DOM (which would surface as lowercased HTML attributes like __groupvalue).
vi.mock("@/components/ui/radio-group", () => {
  const React = require("react")
  const RadioCtx = React.createContext({ value: "", onValueChange: undefined })
  return {
    RadioGroup: ({ children, value, onValueChange, ...props }: any) => (
      <RadioCtx.Provider value={{ value: value ?? "", onValueChange }}>
        <div role="radiogroup" data-value={value ?? ""} {...props}>
          {children}
        </div>
      </RadioCtx.Provider>
    ),
    RadioGroupItem: ({ value, ...props }: any) => {
      const ctx = React.useContext(RadioCtx)
      return (
        <input
          type="radio"
          value={value}
          checked={ctx.value === value}
          onChange={() => ctx.onValueChange?.(value)}
          {...props}
        />
      )
    },
  }
})

vi.mock("@/components/ui/select", () => {
  const React = require("react")
  return {
    Select: ({ children, value, onValueChange }: any) => {
      const items: any[] = []
      React.Children.forEach(children, (child: any) => {
        if (!child) return
        if (child.type?.displayName === "SelectContent") {
          React.Children.forEach(child.props?.children, (item: any) => {
            if (item) items.push(item)
          })
        }
      })
      let triggerId: string | undefined
      let triggerAriaLabel: string | undefined
      React.Children.forEach(children, (child: any) => {
        if (!child) return
        if (child.type?.displayName === "SelectTrigger") {
          triggerId = child.props?.id
          triggerAriaLabel = child.props?.["aria-label"]
        }
      })
      return (
        <select
          id={triggerId}
          aria-label={triggerAriaLabel}
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
    SelectTrigger: Object.assign(({ children }: any) => <>{children}</>, {
      displayName: "SelectTrigger",
    }),
    SelectValue: () => null,
  }
})

// ── Test helpers ─────────────────────────────────────────────────────────────

const MODES: FullSelectorMode[] = [
  "item",
  "range",
  "list",
  "random",
  "modulo",
  "predicate",
  "named-key",
]

function makeData(mode: FullSelectorMode): SelectorNodeData {
  return {
    label: "Selector",
    config: { mode },
  }
}

const baseProps = {
  sources: [],
  fieldMappings: {},
  onMapField: vi.fn(),
  nodes: [],
}

// ── Snapshot tests ───────────────────────────────────────────────────────────

describe("SelectorConfig — per-mode snapshots", () => {
  for (const mode of MODES) {
    it(`renders the ${mode} mode panel`, () => {
      const { container } = render(
        <SelectorConfig {...baseProps} data={makeData(mode)} onUpdate={vi.fn()} />,
      )
      expect(container.firstChild).toMatchSnapshot()
    })
  }
})
