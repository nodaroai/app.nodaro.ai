import { Position } from "@xyflow/react"
import { ScanFace } from "lucide-react"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { PARAMETER_DEFAULT_INPUT_HANDLES } from "./parameter-node-shell"
import { ACCEPTS_PICKER_JSON } from "@/lib/target-handle-registry"
import type { HandleConfig } from "./base-node"

const PICKER_JSON_TOP = "calc(100% - 25px)"

/** Hidden external target-handle config for the `picker-json` input (counts for
 *  sizing; the visible pip is PickerJsonHandleIcon). Shared by all consumers. */
export const PICKER_JSON_INPUT_HANDLES: ReadonlyArray<HandleConfig> = [
  {
    id: "picker-json",
    type: "target",
    position: Position.Left,
    customStyle: { top: PICKER_JSON_TOP, left: "-29px" },
    hideHandle: true,
    external: true,
  },
]

/** Default `in` parameter input + picker-json — for the pickers that keep their
 *  `in` handle and add picker-json (styling/framing/lens/camera-format). Person
 *  uses PICKER_JSON_INPUT_HANDLES alone (it has no `in` handle). Module constant
 *  so the shell's handle `useMemo` keeps reference equality across re-renders
 *  (an inline `[...a, ...b]` literal would bust that cache every render). */
export const PICKER_CONSUMER_INPUT_HANDLES: ReadonlyArray<HandleConfig> = [
  ...PARAMETER_DEFAULT_INPUT_HANDLES,
  ...PICKER_JSON_INPUT_HANDLES,
]

/** The visible picker-json input pip + popover, parameterized by node type. */
export function PickerJsonHandleIcon({ nodeId, nodeType }: { nodeId: string; nodeType: string }) {
  return (
    <HandleWithPopover
      nodeId={nodeId}
      handleId="picker-json"
      nodeType={nodeType}
      type="target"
      position={Position.Left}
      label="Picker JSON"
      color={HANDLE_COLORS.pickerJson}
      icon={<ScanFace className="w-3.5 h-3.5" />}
      accepts={ACCEPTS_PICKER_JSON}
      side="left"
      top={PICKER_JSON_TOP}
      alwaysShowLabel
    />
  )
}

/** "Update from injected" button (manual-apply mode). */
export function PickerUpdateButton({ hasPending, onApply }: { hasPending: boolean; onApply: () => void }) {
  return (
    <button
      type="button"
      disabled={!hasPending}
      onClick={onApply}
      className={`mb-2 w-full rounded-md px-2 py-1 text-xs font-medium ${
        hasPending
          ? "bg-[#ff0073] text-white hover:bg-[#ff0073]/90"
          : "bg-muted text-muted-foreground cursor-not-allowed"
      }`}
    >
      {hasPending ? "⚡ Update from injected" : "Up to date"}
    </button>
  )
}
