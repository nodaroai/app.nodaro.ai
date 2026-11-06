// The face mesh's lines in a Nodaro Motion masking (FaceMaskingEditor, while
// the mesh is on): the full mesh, the eye and lip outlines, the lip outline —
// each offered once every environment's engine draws it — and, in the Motion
// column, "Choose the layers": one switch per layer (`faceMeshLayers`), a set no
// parts value names saved only once every environment takes layers.

import { useId } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { AdminFaceMeshParts, AdminTrendFaceMasking } from "@/lib/api"
import { FaceMeshLayerSwitches } from "./FaceMeshLayerSwitches"
import { layersOfSetting, savedFormOfLayers } from "../face-mesh-layers"

/** What the face mesh draws (`faceMeshParts`; the full mesh is the default, saved as no key). */
const FACE_MESH_PARTS: ReadonlyArray<{ value: AdminFaceMeshParts; label: string; name: string }> = [
  { value: "full", label: "Full (default)", name: "the full face mesh" },
  { value: "features", label: "Eyes and mouth", name: "only the eyes and mouth" },
  { value: "mouth", label: "Mouth only", name: "only the mouth" },
]

interface Props {
  readonly value: AdminTrendFaceMasking | undefined
  readonly set: (patch: Partial<AdminTrendFaceMasking>) => void
  readonly faceMeshPartsMissingIn?: Readonly<Record<"features" | "mouth", readonly string[]>>
  readonly faceMeshLayersMissing?: { readonly engine: readonly string[]; readonly platform: readonly string[] }
}

export function FaceMeshLinesChoice({ value, set, faceMeshPartsMissingIn, faceMeshLayersMissing }: Props) {
  const meshPartsId = `${useId()}-face-mesh-parts`
  const meshParts: AdminFaceMeshParts = value?.faceMeshParts ?? "full"
  const meshLayers = value?.faceMeshLayers
  const meshPartOffered = (p: AdminFaceMeshParts) => p === "full" || (faceMeshPartsMissingIn ? faceMeshPartsMissingIn[p].length === 0 : false)
  const meshPartsUnsupported = meshLayers === undefined && !meshPartOffered(meshParts)
  const noMeshPartOffered = FACE_MESH_PARTS.every((p) => p.value === "full" || !meshPartOffered(p.value))
  const meshPartsLacking = faceMeshPartsMissingIn ? [...new Set([...faceMeshPartsMissingIn.features, ...faceMeshPartsMissingIn.mouth])] : []
  // A set of layers no parts value names needs every environment's engine and platform.
  const layersNeedNew = meshLayers !== undefined && savedFormOfLayers(meshLayers, ["full", "features", "mouth"]).faceMeshLayers !== undefined
  const layersLacking = layersNeedNew ? [...new Set([...(faceMeshLayersMissing?.engine ?? []), ...(faceMeshLayersMissing?.platform ?? [])])] : []
  return (
    <div className="flex flex-col gap-1 sm:w-1/2 sm:pr-1.5">
      <label htmlFor={meshPartsId} className="font-medium">
        Face mesh lines
      </label>
      <Select
        value={meshLayers !== undefined ? "layers" : meshParts}
        disabled={noMeshPartOffered && meshParts === "full" && !faceMeshLayersMissing}
        // The full mesh is no key: a setting without the choice is saved exactly as before it existed. "Choose
        // the layers" starts from what is drawn now.
        onValueChange={(p) =>
          set(
            p === "layers"
              ? { faceMeshParts: undefined, faceMeshLayers: layersOfSetting(value) }
              : { faceMeshParts: p === "full" ? undefined : (p as AdminFaceMeshParts), faceMeshLayers: undefined },
          )
        }
      >
        <SelectTrigger id={meshPartsId} className="h-9" aria-describedby={`${meshPartsId}-hint`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FACE_MESH_PARTS.map((p) => (
            <SelectItem key={p.value} value={p.value} disabled={!meshPartOffered(p.value) && p.value !== meshParts}>
              {p.label}
              {!meshPartOffered(p.value) ? " (not supported yet)" : ""}
            </SelectItem>
          ))}
          {faceMeshLayersMissing && <SelectItem value="layers">Choose the layers</SelectItem>}
        </SelectContent>
      </Select>
      <span id={`${meshPartsId}-hint`} className="text-xs text-muted-foreground">
        What is drawn on each face: the full mesh, only the eye and lip outlines, or only the lip outline{faceMeshLayersMissing ? ", or any layers you choose" : ""}. The prompt names only what is drawn.
      </span>
      {meshLayers !== undefined && (
        <FaceMeshLayerSwitches legend="Face mesh layers" value={meshLayers} onChange={(next) => set({ faceMeshLayers: next })}>
          {layersLacking.length > 0 && (
            <span role="status" className="text-xs text-amber-700 dark:text-amber-400">
              {`${layersLacking.join(", ")} cannot draw these layers yet (its Cast Swap engine or platform is out of date), and this setting is shared by every environment: the save is refused until then. The full mesh, the eyes and lips, or the lips alone save now.`}
            </span>
          )}
        </FaceMeshLayerSwitches>
      )}
      {meshPartsUnsupported && (
        <span role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {`The Cast Swap engine of ${faceMeshPartsMissingIn ? faceMeshPartsMissingIn[meshParts as "features" | "mouth"].join(", ") : "an environment"} cannot draw ${FACE_MESH_PARTS.find((p) => p.value === meshParts)!.name} of the face mesh yet, and this setting is shared by every environment: choose Full to save.`}
        </span>
      )}
      {!meshPartsUnsupported && noMeshPartOffered && meshPartsLacking.length > 0 && (
        <span role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {`The Cast Swap engine of ${meshPartsLacking.join(", ")} cannot draw only parts of the face mesh yet, and this setting is shared by every environment.`}
        </span>
      )}
    </div>
  )
}
