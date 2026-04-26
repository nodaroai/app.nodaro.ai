import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Aperture (label kept as f-stop technical units)
  "aperture-f1-2": { description: "Profondeur de champ ultra-fine, bokeh onirique" },
  "aperture-f1-4": { description: "Isolation agressive du sujet" },
  "aperture-f1-8": { description: "Séparation portrait classique" },
  "aperture-f2-8": { description: "Sujet net, arrière-plan doux" },
  "aperture-f4": { description: "Profondeur de champ équilibrée du quotidien" },
  "aperture-f5-6": { description: "Net sur tout le sujet" },
  "aperture-f8": { description: "Netteté optimale" },
  "aperture-f11": { description: "Profondeur de champ paysagère" },
  "aperture-f16": { description: "Hyperfocale, étoiles de soleil" },
  // Shutter speed (label kept as technical units)
  "shutter-1-30": { label: "1/30 (flou tenu à la main)", description: "Soupçon de mouvement à main levée" },
  "shutter-1-60": { description: "Vitesse standard du quotidien" },
  "shutter-1-200": { description: "Net sur la plupart des sujets" },
  "shutter-1-500": { description: "Net sur action rapide" },
  "shutter-1-1000": { label: "1/1000 (figeage d'action)", description: "Sports/faune figés" },
  "shutter-long-1s": { label: "Pose longue (1s)", description: "Filés et traînées de mouvement" },
  // ISO (label kept as technical units)
  "iso-100": { label: "ISO 100 (propre)", description: "Bruit minimal, grain fin" },
  "iso-400": { description: "Légère texture, ISO du quotidien" },
  "iso-800": { description: "Grain visible mais agréable" },
  "iso-1600": { label: "ISO 1600 (grain visible)", description: "Texture éditoriale en faible lumière" },
  "iso-3200": { label: "ISO 3200 (grain prononcé)", description: "Poussé, sensation documentaire crue" },
}

export default map
