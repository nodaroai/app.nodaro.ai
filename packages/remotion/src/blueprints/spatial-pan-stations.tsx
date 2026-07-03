import React from "react"
import { useCurrentFrame, useVideoConfig } from "remotion"
import type { BlueprintProps } from "./types"
import { directionStyle } from "../lib/text-direction"
import { readableTextColor } from "./color"
import { popWithSettle } from "./motion"
import { blueprintFontFamily, resolveBlueprintAccent } from "../lib/brand"

interface Params {
  stations: Array<{ label: string; sublabel?: string }>
  variant?: "timeline" | "web"
  accentColor?: string
}

/** Within each leg, the camera pans for this fraction and holds for the rest. */
export const PAN_FRACTION_OF_LEG = 0.6

/** Quadratic ease-in-out — gentle launch and landing for each pan leg. */
function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) * (-2 * t + 2)) / 2
}

/**
 * Virtual-camera state for the stations pan at `frame` within a window of
 * `durationInFrames` over `stationCount` stations.
 *
 * The window divides into one segment per station. Segment 0 holds on station
 * 0; each later segment pans (ease-in-out, PAN_FRACTION_OF_LEG of the segment)
 * from the previous station and holds the remainder. The last segment's hold
 * runs to the end of the window.
 *
 * - `cameraPos`: the camera's position in station units (0 … stationCount-1,
 *   fractional mid-pan; exact integers while holding).
 * - `worldX`: -cameraPos — the world's offset in station-spacing multiples
 *   (the component multiplies by its spacing). Monotonically non-increasing.
 * - `arrived`: true while resting on a station center.
 * - `legIndex`: the current segment (= the station being travelled to / held).
 * - `segLen`: the segment length in frames — single source for callers that
 *   derive per-station timings (arrival frames, reveal starts).
 * Pure function — safe to unit-test without a render.
 */
export function panCamera(
  frame: number,
  durationInFrames: number,
  stationCount: number,
): { legIndex: number; cameraPos: number; worldX: number; arrived: boolean; segLen: number } {
  const segLen = durationInFrames / Math.max(1, stationCount)
  const legIndex = Math.max(0, Math.min(stationCount - 1, Math.floor(frame / segLen)))

  if (legIndex === 0) {
    return { legIndex: 0, cameraPos: 0, worldX: -0, arrived: true, segLen }
  }

  const t = (frame - legIndex * segLen) / segLen
  let cameraPos: number
  let arrived: boolean
  if (t >= PAN_FRACTION_OF_LEG) {
    cameraPos = legIndex
    arrived = true
  } else {
    cameraPos = legIndex - 1 + easeInOut(t / PAN_FRACTION_OF_LEG)
    arrived = false
  }
  return { legIndex, cameraPos, worldX: -cameraPos, arrived, segLen }
}

export function SpatialPanStations({ params, durationInFrames, brand }: BlueprintProps) {
  const { stations, variant = "timeline", accentColor } = params as unknown as Params
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()

  const fontFamily = blueprintFontFamily(brand)
  const primaryColor = readableTextColor(brand.backgroundColor)
  const emphasisColor = resolveBlueprintAccent(accentColor, brand, primaryColor)

  const { legIndex, cameraPos, arrived, segLen } = panCamera(frame, durationInFrames, stations.length)

  // World layout — stations pre-placed in world space, one virtual camera.
  const spacing = width * 0.7
  const stationX = (k: number) => width / 2 + k * spacing
  const stationY = (k: number) =>
    variant === "web" ? height / 2 + (k % 2 === 0 ? -1 : 1) * height * 0.16 : height / 2

  // Camera center follows cameraPos (y interpolates between station heights on web).
  const lo = Math.floor(cameraPos)
  const hi = Math.min(stations.length - 1, Math.ceil(cameraPos))
  const frac = cameraPos - lo
  const camX = stationX(lo) + (stationX(hi) - stationX(lo)) * frac
  const camY = stationY(lo) + (stationY(hi) - stationY(lo)) * frac

  const labelFontSize = Math.round(height * 0.055)
  const sublabelFontSize = Math.round(height * 0.032)
  const calloutFontSize = Math.round(height * 0.04)

  // Per-station arrival frame — the moment its leg's pan completes (station 0 at frame 0).
  const arrivalFrame = (k: number) => (k === 0 ? 0 : k * segLen + segLen * PAN_FRACTION_OF_LEG)

  // Spring-pop progress for a callout that appears once the camera arrives.
  const calloutPop = (arrival: number) => popWithSettle((frame - arrival) / 10)

  // Web variant's terminal scribble knot draws over the final hold.
  const knotStart = arrivalFrame(stations.length - 1) + 6
  const knotT = Math.max(0, Math.min(1, (frame - knotStart) / Math.max(1, durationInFrames - knotStart - 4)))

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
      {/* The world — everything pre-placed; only this container moves */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          transform: `translate(${width / 2 - camX}px, ${height / 2 - camY}px)`,
        }}
      >
        {/* Timeline rail (timeline variant) or faint connecting legs (web variant) */}
        {variant === "timeline" ? (
          <div
            style={{
              position: "absolute",
              left: stationX(0) - spacing * 0.4,
              top: height / 2,
              width: spacing * (stations.length - 1) + spacing * 0.8,
              height: 3,
              backgroundColor: `${primaryColor}44`,
            }}
          />
        ) : (
          <svg
            style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
            width={1}
            height={1}
          >
            {stations.slice(1).map((_, i) => (
              <line
                key={i}
                x1={stationX(i)}
                y1={stationY(i)}
                x2={stationX(i + 1)}
                y2={stationY(i + 1)}
                stroke={`${emphasisColor}66`}
                strokeWidth={2.5}
                strokeDasharray="8 7"
              />
            ))}
            {/* Terminal scribble knot — the visual punchline of the mess */}
            {knotT > 0 && (
              <path
                d={`M ${stationX(stations.length - 1) - 70} ${stationY(stations.length - 1) + 60}
                    c 40 -30, 90 -10, 60 25
                    c -30 35, -95 20, -60 -18
                    c 35 -38, 100 -5, 55 30
                    c -45 35, -85 -12, -35 -35`}
                fill="none"
                stroke={emphasisColor}
                strokeWidth={4}
                strokeLinecap="round"
                pathLength={1}
                strokeDasharray={1}
                strokeDashoffset={1 - knotT}
              />
            )}
          </svg>
        )}

        {/* Stations */}
        {stations.map((station, k) => {
          const pop = calloutPop(arrivalFrame(k))
          // The station's leg has started — the pan toward it is underway.
          const revealed = frame >= k * segLen
          if (!revealed) return null
          // Computed once — both the timeline and web variant branches need
          // the same label/sublabel direction (only one branch renders).
          const labelDir = directionStyle(station.label)
          const sublabelDir = station.sublabel != null ? directionStyle(station.sublabel) : undefined
          return (
            <div key={k} style={{ position: "absolute", left: stationX(k), top: stationY(k) }}>
              {/* Marker dot on the rail / web point */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  transform: "translate(-50%, -50%)",
                  width: Math.round(height * 0.022),
                  height: Math.round(height * 0.022),
                  borderRadius: "50%",
                  backgroundColor: emphasisColor,
                }}
              />
              {variant === "timeline" ? (
                <>
                  {/* Spring-popped callout box above the marker (origin at the triangle tip) */}
                  {pop > 0 && (
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        bottom: Math.round(height * 0.035),
                        transform: `translateX(-50%) scale(${pop})`,
                        transformOrigin: "50% 100%",
                        padding: `${Math.round(height * 0.014)}px ${Math.round(width * 0.016)}px`,
                        border: `2.5px solid ${emphasisColor}`,
                        borderRadius: Math.round(height * 0.012),
                        backgroundColor: brand.backgroundColor,
                        fontFamily,
                        fontSize: calloutFontSize,
                        fontWeight: 700,
                        color: primaryColor,
                        whiteSpace: "nowrap",
                        ...labelDir,
                      }}
                    >
                      {station.label}
                      {/* Downward triangle anchoring the callout to its marker */}
                      <div
                        style={{
                          position: "absolute",
                          left: "50%",
                          bottom: -Math.round(height * 0.016),
                          transform: "translateX(-50%)",
                          width: 0,
                          height: 0,
                          borderLeft: `${Math.round(height * 0.012)}px solid transparent`,
                          borderRight: `${Math.round(height * 0.012)}px solid transparent`,
                          borderTop: `${Math.round(height * 0.016)}px solid ${emphasisColor}`,
                        }}
                      />
                    </div>
                  )}
                  {/* Secondary label rises and fades in above the callout */}
                  {station.sublabel != null && pop > 0.5 && (
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        bottom: Math.round(height * 0.14),
                        transform: `translateX(-50%) translateY(${(1 - Math.min(1, (pop - 0.5) * 2)) * 14}px)`,
                        opacity: Math.min(1, (pop - 0.5) * 2),
                        fontFamily,
                        fontSize: sublabelFontSize,
                        fontWeight: 300,
                        color: emphasisColor,
                        whiteSpace: "nowrap",
                        ...sublabelDir,
                      }}
                    >
                      {station.sublabel}
                    </div>
                  )}
                </>
              ) : (
                // Web variant: plain label beneath the point, revealed by the pan alone
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: Math.round(height * 0.03),
                    transform: "translateX(-50%)",
                    fontFamily,
                    fontSize: labelFontSize,
                    fontWeight: 600,
                    color: primaryColor,
                    whiteSpace: "nowrap",
                    textAlign: "center",
                    ...labelDir,
                  }}
                >
                  {station.label}
                  {station.sublabel != null && (
                    <div
                      style={{
                        fontSize: sublabelFontSize,
                        fontWeight: 300,
                        color: emphasisColor,
                        marginTop: 4,
                        ...sublabelDir,
                      }}
                    >
                      {station.sublabel}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Leg counter (subtle, screen-space): current stop / total — aids orientation */}
      <div
        style={{
          position: "absolute",
          right: Math.round(width * 0.03),
          bottom: Math.round(height * 0.04),
          fontFamily,
          fontSize: Math.round(height * 0.024),
          fontWeight: 500,
          color: `${primaryColor}88`,
        }}
      >
        {Math.min(stations.length, (arrived ? legIndex : legIndex - 1) + 1)} / {stations.length}
      </div>
    </div>
  )
}
