// One switch per face mesh layer (Admin → Nodaro Motion: the Motion column's
// masking and the Precise art-style route), any combination. Bold changes the
// other layers' lines and draws nothing on its own, so a set of bold alone (or
// nothing) is said in place and cannot be saved.

import { useId } from "react"
import type { VideoFaceMeshLayers } from "@nodaro/shared/media"
import { Switch } from "@/components/ui/switch"
import { FACE_MESH_LAYER_OPTIONS, layersDrawLines, withLayer } from "../face-mesh-layers"

interface Props {
  /** The layers on. */
  readonly value: VideoFaceMeshLayers
  readonly onChange: (next: VideoFaceMeshLayers) => void
  /** The group's name, read by a screen reader. */
  readonly legend: string
  /** Said under the switches (a hint, or why a set cannot be saved yet). */
  readonly children?: React.ReactNode
}

export function FaceMeshLayerSwitches({ value, onChange, legend, children }: Props) {
  const id = useId()
  return (
    <fieldset className="flex min-w-0 flex-col gap-1" data-testid="face-mesh-layer-switches">
      <legend className="font-medium">{legend}</legend>
      {FACE_MESH_LAYER_OPTIONS.map((o) => {
        const switchId = `${id}-${o.value}`
        return (
          <div key={o.value} className="flex min-h-11 items-start gap-2 sm:min-h-9">
            <Switch
              id={switchId}
              className="mt-0.5"
              checked={value[o.value] === true}
              aria-describedby={`${switchId}-hint`}
              onCheckedChange={(on) => onChange(withLayer(value, o.value, on))}
            />
            <div className="flex min-w-0 flex-col">
              <label htmlFor={switchId} className="text-sm">
                {o.label}
              </label>
              <span id={`${switchId}-hint`} className="text-xs text-muted-foreground">
                {o.hint}
              </span>
            </div>
          </div>
        )
      })}
      {!layersDrawLines(value) && (
        <span role="alert" className="text-xs text-destructive">
          Turn on at least one layer other than Bold lines: these layers draw nothing.
        </span>
      )}
      {children}
    </fieldset>
  )
}
