"use client"

import type { ReactNode } from "react"
import { Position } from "@xyflow/react"
import { Braces, Film, ImageIcon, SlidersHorizontal, Type } from "lucide-react"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import type { HandleConfig } from "./base-node"
import { UGC_TARGET_HANDLES, type UgcPipKind } from "@/lib/ugc-handles"

/** The vertical position of a UGC node's i-th pip on either side. */
export const ugcPipTop = (i: number): string => `${24 + i * 28}px`

const PIP_COLOR: Readonly<Record<UgcPipKind, string>> = {
  image: HANDLE_COLORS.image,
  text: HANDLE_COLORS.text,
  video: HANDLE_COLORS.video,
  json: HANDLE_COLORS.look,
  picker: HANDLE_COLORS.look,
}

const PIP_ICON: Readonly<Record<UgcPipKind, ReactNode>> = {
  image: <ImageIcon />,
  text: <Type />,
  video: <Film />,
  json: <Braces />,
  picker: <SlidersHorizontal />,
}

/** The BaseNode handle entries of a UGC node (all drawn here or by the node's own output pips). */
export function ugcNodeHandles(nodeType: string, outputs: readonly string[]): HandleConfig[] {
  const inputs = UGC_TARGET_HANDLES[nodeType] ?? []
  return [
    ...inputs.map((row, i) => ({
      id: row.handleId,
      type: "target" as const,
      position: Position.Left,
      customStyle: { top: ugcPipTop(i), left: "-29px" },
      external: true,
    })),
    ...outputs.map((handleId, i) => ({
      id: handleId,
      type: "source" as const,
      position: Position.Right,
      customStyle: { top: ugcPipTop(i), right: "-29px" },
      external: true,
    })),
  ]
}

/** A UGC node's input pips, drawn from its rows in `ugc-handles.ts` — the same label and `accepts` the validator and the popover read. */
export function UgcInputPips({ nodeId, nodeType }: { readonly nodeId: string; readonly nodeType: string }) {
  const rows = UGC_TARGET_HANDLES[nodeType] ?? []
  return (
    <>
      {rows.map((row, i) => (
        <HandleWithPopover
          key={row.handleId}
          nodeId={nodeId}
          nodeType={nodeType}
          handleId={row.handleId}
          type="target"
          position={Position.Left}
          label={row.label}
          color={PIP_COLOR[row.kind]}
          icon={PIP_ICON[row.kind]}
          side="left"
          top={ugcPipTop(i)}
          accepts={row.accepts}
        />
      ))}
    </>
  )
}
