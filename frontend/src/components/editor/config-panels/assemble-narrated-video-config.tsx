"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { AssembleNarratedVideoData } from "@/types/nodes"
import type { ConfigProps } from "./types"

/**
 * Five numeric knobs for the audio-led narrated-video assembler. No provider
 * lever exists on this node (pure ffmpeg fit logic), so there is no
 * fail-safe useEffect to wire (see CLAUDE.md Provider Enum Sync pitfall 5 —
 * N/A here since there's nothing to snap/clear).
 */
export function AssembleNarratedVideoConfig({ data, onUpdate }: ConfigProps<AssembleNarratedVideoData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="voice-volume">Voice Volume (%) — {data.voiceVolume ?? 100}</Label>
        <Input
          id="voice-volume"
          type="number"
          min={0}
          max={200}
          value={data.voiceVolume ?? ""}
          onChange={(e) =>
            onUpdate({ voiceVolume: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })
          }
        />
      </div>

      <div>
        <Label htmlFor="clip-audio-volume">Clip Audio Volume (%) — {data.clipAudioVolume ?? 40}</Label>
        <Input
          id="clip-audio-volume"
          type="number"
          min={0}
          max={200}
          value={data.clipAudioVolume ?? ""}
          onChange={(e) =>
            onUpdate({ clipAudioVolume: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })
          }
        />
      </div>

      <div>
        <Label htmlFor="max-slowdown">Max Slowdown — {data.maxSlowdown ?? 1.5}×</Label>
        <Input
          id="max-slowdown"
          type="number"
          min={1}
          max={2}
          step={0.1}
          value={data.maxSlowdown ?? ""}
          onChange={(e) =>
            onUpdate({ maxSlowdown: e.target.value === "" ? undefined : parseFloat(e.target.value) })
          }
        />
      </div>

      <div>
        <Label htmlFor="trim-start-frames">
          Trim each clip start (frames, except first) — {data.trimStartFrames ?? 0}
        </Label>
        <Input
          id="trim-start-frames"
          type="number"
          min={0}
          max={120}
          step={1}
          value={data.trimStartFrames ?? 0}
          onChange={(e) =>
            onUpdate({ trimStartFrames: e.target.value === "" ? 0 : parseInt(e.target.value, 10) })
          }
        />
      </div>

      <div>
        <Label htmlFor="trim-end-frames">
          Trim each clip end (frames, except last) — {data.trimEndFrames ?? 0}
        </Label>
        <Input
          id="trim-end-frames"
          type="number"
          min={0}
          max={120}
          step={1}
          value={data.trimEndFrames ?? 0}
          onChange={(e) =>
            onUpdate({ trimEndFrames: e.target.value === "" ? 0 : parseInt(e.target.value, 10) })
          }
        />
      </div>
    </div>
  )
}
