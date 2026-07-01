import React from "react"
import { useCurrentFrame, useVideoConfig } from "remotion"
import type { BlueprintProps } from "./types"
import { FONT_MAP } from "../lib/font-registry"
import { readableTextColor } from "./color"

interface Params {
  hubLabel: string
  nodes: Array<{ label: string }>
  finisher?: "push-in" | "orbit"
  accentColor?: string
}

/** Frames between consecutive node entrances. */
export const ENTRANCE_STAGGER_FRAMES = 4
/** A node's spring-pop entrance lasts this many frames. */
const ENTRANCE_FRAMES = 12
/** The resolve phase (push-in or orbit) starts at this fraction of the duration. */
export const RESOLVE_FRACTION = 0.45
/** Connector lines draw over this window (fractions of the duration). */
const CONNECT_START_FRACTION = 0.25
/** Orbit finisher: ring revolves at ~20°/s (in radians per frame at 30fps). */
const ORBIT_RADIANS_PER_FRAME = (20 * Math.PI) / 180 / 30
/** Push-in finisher: max blur applied to ring nodes as the camera resolves on the hub. */
const PUSH_IN_MAX_BLUR = 8

/**
 * Position + entrance/resolve state for ring node `nodeIndex` of `nodeCount`
 * at `frame` within a reveal window of `durationInFrames`.
 *
 * `x`/`y` are unit-circle multiples (the component multiplies by the ring
 * radius). Entrances are staggered by index and pop with a small overshoot
 * (≤1.15) settling to 1. During the resolve phase (≥ RESOLVE_FRACTION):
 *  - "orbit": the ring revolves (positions rotate, blur stays 0);
 *  - "push-in": positions hold (the camera move is a group transform) and
 *    `blur` grows so outer nodes defocus while the hub stays sharp.
 * Pure function — safe to unit-test without a render.
 */
export function ringNodeTransform(
  frame: number,
  durationInFrames: number,
  nodeIndex: number,
  nodeCount: number,
  finisher: "push-in" | "orbit",
): { x: number; y: number; scale: number; blur: number; entered: boolean } {
  const resolveStart = durationInFrames * RESOLVE_FRACTION

  // Ring placement — start at 12 o'clock, clockwise, evenly spaced.
  let angle = -Math.PI / 2 + (nodeIndex * 2 * Math.PI) / Math.max(1, nodeCount)
  if (finisher === "orbit" && frame > resolveStart) {
    angle += (frame - resolveStart) * ORBIT_RADIANS_PER_FRAME
  }
  const x = Math.cos(angle)
  const y = Math.sin(angle)

  // Staggered spring-pop entrance: 0 → overshoot (1.12) → settle at 1.
  const entranceStart = nodeIndex * ENTRANCE_STAGGER_FRAMES
  const e = (frame - entranceStart) / ENTRANCE_FRAMES
  let scale: number
  if (e <= 0) {
    scale = 0
  } else if (e >= 1) {
    scale = 1
  } else if (e < 0.7) {
    // Quadratic ease-out up to a gentle 1.12 overshoot.
    const t = e / 0.7
    scale = (1 - (1 - t) * (1 - t)) * 1.12
  } else {
    // Linear settle from the overshoot back to resting scale.
    const t = (e - 0.7) / 0.3
    scale = 1.12 - 0.12 * t
  }
  const entered = e > 0

  // Push-in resolve: ring nodes defocus progressively (quadratic ease-in
  // reads as the depth-of-field collapsing onto the hub).
  let blur = 0
  if (finisher === "push-in" && frame > resolveStart) {
    const t = Math.min(1, (frame - resolveStart) / Math.max(1, durationInFrames - resolveStart))
    blur = t * t * PUSH_IN_MAX_BLUR
  }

  return { x, y, scale, blur, entered }
}

export function ConstellationHub({ params, durationInFrames, brand }: BlueprintProps) {
  const { hubLabel, nodes, finisher = "push-in", accentColor } = params as unknown as Params
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()

  const fontFamily = FONT_MAP["Montserrat"] ?? "Montserrat"
  const primaryColor = readableTextColor(brand.backgroundColor)
  const emphasisColor = accentColor ?? primaryColor

  const radius = Math.min(width, height) * 0.32
  const cx = width / 2
  const cy = height / 2

  // Connector lines draw hub→node between 25% and 45% of the window, staggered.
  const connectStart = durationInFrames * CONNECT_START_FRACTION
  const connectEnd = durationInFrames * RESOLVE_FRACTION
  const connectWindow = Math.max(1, connectEnd - connectStart)

  // Resolve-phase group transforms.
  const resolveStart = durationInFrames * RESOLVE_FRACTION
  const resolveT = Math.max(
    0,
    Math.min(1, (frame - resolveStart) / Math.max(1, durationInFrames - resolveStart)),
  )
  // Quadratic ease-out for the camera move.
  const resolveProgress = 1 - (1 - resolveT) * (1 - resolveT)
  // push-in: the whole constellation scales up toward the viewer; the hub grows
  // a little extra and stays sharp while the ring defocuses (depth of field).
  // orbit: a slight zoom-out reveals the ecosystem while the ring revolves.
  const groupScale = finisher === "push-in" ? 1 + 0.6 * resolveProgress : 1 - 0.08 * resolveProgress
  const ringOpacity = finisher === "push-in" ? 1 - 0.65 * resolveProgress : 1
  const hubScale = finisher === "push-in" ? 1 + 0.25 * resolveProgress : 1

  const nodeFontSize = Math.round(height * 0.032)
  const hubFontSize = Math.round(height * 0.05)
  const nodePadV = Math.round(height * 0.012)
  const nodePadH = Math.round(width * 0.014)

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width,
        height,
        backgroundColor: brand.backgroundColor,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width,
          height,
          transform: `scale(${groupScale})`,
          transformOrigin: `${cx}px ${cy}px`,
        }}
      >
        {/* Connector lines hub→node (drawn via pathLength dashoffset) */}
        <svg
          width={width}
          height={height}
          style={{ position: "absolute", top: 0, left: 0 }}
        >
          {nodes.map((_, i) => {
            const t = ringNodeTransform(frame, durationInFrames, i, nodes.length, finisher)
            const lineT = Math.max(
              0,
              Math.min(1, (frame - (connectStart + i * 2)) / connectWindow),
            )
            const drawn = 1 - (1 - lineT) * (1 - lineT)
            if (drawn <= 0) return null
            return (
              <line
                key={i}
                x1={cx}
                y1={cy}
                x2={cx + t.x * radius}
                y2={cy + t.y * radius}
                stroke={emphasisColor}
                strokeWidth={2}
                opacity={0.5 * ringOpacity}
                pathLength={1}
                strokeDasharray={1}
                strokeDashoffset={1 - drawn}
              />
            )
          })}
        </svg>

        {/* Ring node chips */}
        {nodes.map((node, i) => {
          const t = ringNodeTransform(frame, durationInFrames, i, nodes.length, finisher)
          if (!t.entered) return null
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: cx + t.x * radius,
                top: cy + t.y * radius,
                transform: `translate(-50%, -50%) scale(${t.scale})`,
                fontFamily,
                fontSize: nodeFontSize,
                fontWeight: 500,
                color: primaryColor,
                padding: `${nodePadV}px ${nodePadH}px`,
                borderRadius: 999,
                border: `2px solid ${emphasisColor}55`,
                backgroundColor: `${emphasisColor}14`,
                whiteSpace: "nowrap",
                opacity: ringOpacity,
                filter: t.blur > 0 ? `blur(${t.blur}px)` : undefined,
              }}
            >
              {node.label}
            </div>
          )
        })}

        {/* Center hub — stays sharp; grows on push-in */}
        <div
          style={{
            position: "absolute",
            left: cx,
            top: cy,
            transform: `translate(-50%, -50%) scale(${hubScale})`,
            fontFamily,
            fontSize: hubFontSize,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: primaryColor,
            padding: `${nodePadV * 1.4}px ${nodePadH * 1.8}px`,
            borderRadius: 999,
            border: `3px solid ${emphasisColor}`,
            backgroundColor: brand.backgroundColor,
            whiteSpace: "nowrap",
          }}
        >
          {hubLabel}
        </div>
      </div>
    </div>
  )
}
