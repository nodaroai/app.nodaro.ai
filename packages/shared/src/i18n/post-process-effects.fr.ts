import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "vignette-soft": { label: "Vignettage doux", description: "Assombrissement doux des coins" },
  "vignette-heavy": { label: "Vignettage prononcé", description: "Coins noirs dramatiques" },
  "dodge-and-burn": { description: "Hautes lumières et ombres sculptées" },
  "film-grain-fine": { label: "Grain de pellicule fin", description: "Grain subtil style 35mm" },
  "film-grain-heavy": { label: "Grain de pellicule prononcé", description: "Grain grossier de pellicule poussée" },
  "halation-glow": { description: "Floraison rouge style Cinestill" },
  "bloom-glow": { description: "Floraison romantique onirique des hautes lumières" },
  "chromatic-aberration": { label: "Aberration chromatique", description: "Frange rouge/cyan sur les bords" },
  "light-leak": { description: "Traînée chaude en travers du cadre" },
  "film-burn": { description: "Flare de coin Super-8 vintage" },
  "scratched-emulsion": { label: "Émulsion rayée", description: "Rayures de pellicule vieillie + poussière" },
  "color-fringe": { label: "Frange de couleur", description: "Subtile frange à fort contraste" },
  "soft-focus-diffusion": { label: "Diffusion mise au point douce", description: "Floraison brumeuse onirique des hautes lumières" },
  "contrast-boost": { label: "Boost de contraste", description: "Ombres écrasées + hautes lumières poussées" },
  "sharpening": { label: "Accentuation prononcée", description: "Passe d'accentuation des bords agressive" },
  "clarity-boost": { label: "Boost de clarté", description: "Amélioration de la clarté des tons moyens, contraste local accru" },
  "dehaze": { label: "Suppression du voile", description: "Suppression atmosphérique du voile, supprimant la douceur" },
  "lift-gamma-gain": { label: "Étalonnage Lift-Gamma-Gain", description: "Roues d'étalonnage couleur trois voies" },
}

export default map
