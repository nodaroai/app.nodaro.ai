/**
 * Canonical catalog of atmosphere / environmental effects.
 *
 * Atmosphere dimension of a shot — environmental elements in the air that
 * affect visibility and mood (rain, fog, god rays, particles). Independent
 * of lighting (color/direction of light) and color/look (post-processing
 * tone). A sunny scene with fog has different atmosphere than a clear sunny
 * scene, even with identical subject, lighting and color grade.
 *
 * Shared between the picker UI and the prompt-hint injection on both the
 * frontend DAG executor and the backend orchestrator.
 */

export interface Atmosphere {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly promptHint: string
}

export const ATMOSPHERES: ReadonlyArray<Atmosphere> = [
  { id: "clear",           label: "Clear",           description: "Clean, no atmospheric effect",             promptHint: "clear atmosphere, clean visibility with no fog or particles" },
  { id: "overcast",        label: "Overcast",        description: "Uniform gray cloud cover",                 promptHint: "overcast atmosphere, uniform gray cloud cover with diffused flat light" },
  { id: "fog-mist",        label: "Fog / Mist",      description: "Soft diffusing fog",                       promptHint: "foggy atmosphere, soft mist reducing visibility and diffusing distant elements" },
  { id: "light-rain",      label: "Light Rain",      description: "Soft falling rain",                        promptHint: "light rain falling softly, subtle droplets visible in the air with wet surfaces" },
  { id: "heavy-rain",      label: "Heavy Rain",      description: "Heavy storm with sheets of rain",          promptHint: "heavy rainstorm, dense sheets of rain with visible droplets and splashing surfaces" },
  { id: "snow",            label: "Snow",            description: "Falling snowflakes",                       promptHint: "falling snow, snowflakes drifting through the air and accumulating on surfaces" },
  { id: "dust",            label: "Dust",            description: "Dust particles in air",                    promptHint: "dusty atmosphere, visible airborne dust particles catching light and softening distant elements" },
  { id: "god-rays",        label: "God Rays",        description: "Sun shafts through haze",                  promptHint: "visible volumetric god rays, sun shafts cutting through hazy atmosphere" },
  { id: "smoke",           label: "Smoke",           description: "Drifting smoke",                           promptHint: "drifting smoke in the scene, hazy volumetric smoke partially obscuring the subject" },
  { id: "bokeh-particles", label: "Bokeh Particles", description: "Floating out-of-focus specks",             promptHint: "floating bokeh particles in the air, out-of-focus glowing specks adding ambient depth" },
] as const

const atmosphereById = new Map<string, Atmosphere>(ATMOSPHERES.map((a) => [a.id, a]))

export function getAtmosphere(id: string | undefined | null): Atmosphere | undefined {
  if (!id) return undefined
  return atmosphereById.get(id)
}

export function getAtmosphereLabel(id: string | undefined | null, fallback?: string): string {
  const a = getAtmosphere(id)
  if (a) return a.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getAtmospherePromptHint(id: string | undefined | null): string {
  return getAtmosphere(id)?.promptHint ?? ""
}

export const ATMOSPHERE_IDS: ReadonlyArray<string> = ATMOSPHERES.map((a) => a.id)
