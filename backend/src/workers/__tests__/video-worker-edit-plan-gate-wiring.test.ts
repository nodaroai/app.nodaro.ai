// Track D1: the cloud plugin's edit-plan handler is merged into the video
// worker's map only through the mode gate, fed by `plannableEditPlanModes`
// (round 6, decided 2026-10-06: the one helper every lane reads — the loaded
// plugin's declaration on nodaro.ai, nodaro.ai's answer on a connected self-host). Without it an older plugin plans a trailer job as `tighten` after
// the run reserved the trailer price. The gate's behaviour is pinned by
// lib/private-plugins/__tests__/edit-plan-mode-gate.test.ts; this pins the wiring.
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const src = readFileSync(resolve(__dirname, "../video-worker.ts"), "utf8")
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("video-worker edit-plan mode gate wiring", () => {
  it("merges the plugin handlers through the gate, asking the one plannable-modes helper", () => {
    expect(code).toMatch(/import \{ plannableEditPlanModes \} from "\.\.\/lib\/private-plugins\/plannable-edit-plan-modes\.js"/)
    expect(code).toMatch(/Object\.assign\(allHandlers, withEditPlanModeGate\(privatePluginHandlers, plannableEditPlanModes\)\)/)
    expect(code).not.toMatch(/Object\.assign\(allHandlers, privatePluginHandlers\)/)
  })

  // Round 4 (decided 2026-10-06): the self-host relay to nodaro.ai refuses an
  // unknown or unplannable mode too, before anything is relayed. Round 6: what
  // is plannable there is what nodaro.ai plans, when the install is connected.
  it("merges the self-host relay handlers through the same gate, after the plugins load", () => {
    expect(code).toMatch(/Object\.assign\(allHandlers, withEditPlanModeGate\(nodaroExclusiveRelayHandlers, plannableEditPlanModes\)\)/)
    expect(code).not.toMatch(/Object\.assign\(allHandlers, nodaroExclusiveRelayHandlers\)/)
    const load = code.indexOf("await loadPrivatePlugins({})")
    const relay = code.indexOf("withEditPlanModeGate(nodaroExclusiveRelayHandlers")
    const plugin = code.indexOf("withEditPlanModeGate(privatePluginHandlers")
    expect(load).toBeGreaterThanOrEqual(0)
    // the plugins (and their supports) load before the relay is gated; the relay still merges BEFORE
    // the plugin handlers, so on nodaro.ai the plugin keeps every key.
    expect(relay).toBeGreaterThan(load)
    expect(plugin).toBeGreaterThan(relay)
  })
})
