import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "vignette-soft": { label: "Sanfte Vignette", description: "Sanfte Eckverdunkelung" },
  "vignette-heavy": { label: "Starke Vignette", description: "Dramatische schwarze Ecken" },
  "dodge-and-burn": { label: "Dodge & Burn", description: "Modellierte Glanzlichter/Schatten" },
  "film-grain-fine": { label: "Feines Filmkorn", description: "Subtiles 35mm-artiges Korn" },
  "film-grain-heavy": { label: "Starkes Filmkorn", description: "Grobes pushed-processed Korn" },
  "halation-glow": { label: "Halation-Leuchten", description: "Cinestill-Rot-Halo-Bloom" },
  "bloom-glow": { label: "Bloom-Leuchten", description: "Romantischer verträumter Glanzlicht-Bloom" },
  "chromatic-aberration": { description: "Rot/Cyan-Saum an den Kanten" },
  "light-leak": { label: "Lichtleck", description: "Warmer Streifen über den Bildausschnitt" },
  "film-burn": { label: "Filmverbrennung", description: "Vintage Super-8 Eckflare" },
  "scratched-emulsion": { label: "Zerkratzte Emulsion", description: "Gealterte Filmkratzer + Staub" },
  "color-fringe": { label: "Farbsaum", description: "Subtiles Hochkontrast-Fringing" },
  "soft-focus-diffusion": { label: "Soft-Focus-Diffusion", description: "Diesiger verträumter Glanzlicht-Bloom" },
  "contrast-boost": { label: "Kontrast-Boost", description: "Verstärkte Schatten + erhöhte Glanzlichter" },
  "sharpening": { label: "Starke Schärfung", description: "Aggressiver Kantenschärfungs-Durchgang" },
  "clarity-boost": { label: "Klarheits-Boost", description: "Verbesserung der Mitteltonklarheit, erhöhter lokaler Kontrast" },
  "dehaze": { label: "Dunst entfernen", description: "Atmosphärische Dunstentfernung angewendet, beseitigt Weichheit" },
  "lift-gamma-gain": { label: "Lift-Gamma-Gain-Grading", description: "Dreiwege-Color-Grading-Räder" },
}

export default map
