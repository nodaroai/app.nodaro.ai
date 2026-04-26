import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Speed
  "real-time": { label: "Temps réel", description: "Vitesse de lecture normale" },
  "slow-motion": { label: "Ralenti", description: "Métrage modérément ralenti" },
  "super-slow-mo": { label: "Super ralenti", description: "Métrage extrêmement ralenti" },
  "time-lapse": { label: "Time-lapse", description: "Temps compressé, passage rapide" },
  "hyper-lapse": { label: "Hyperlapse", description: "Time-lapse en mouvement" },
  "speed-ramp": { description: "Changement de vitesse dynamique en cours de plan" },
  // Freeze
  "full-freeze": { label: "Arrêt sur image complet", description: "Tout mouvement figé" },
  "bullet-time": { description: "Sujet figé, caméra en orbite" },
  "frozen-subject": { label: "Sujet figé", description: "Sujet figé, monde en mouvement" },
  "moving-subject": { label: "Sujet en mouvement", description: "Sujet en mouvement, monde figé" },
  // Direction
  "forward": { label: "Avant", description: "Lecture avant normale" },
  "reverse": { label: "Inverse / Rembobinage", description: "Le temps s'écoule à l'envers" },
  "loop-boomerang": { label: "Boucle / Boomerang", description: "Avant puis arrière" },
  // Shutter
  "long-exposure": { label: "Pose longue", description: "Filés de mouvement et traînées" },
  "crisp-shutter": { label: "Obturation nette", description: "Mouvement net, pas de flou" },
  "motion-blur": { description: "Flou directionnel prononcé" },
  "stutter-strobe": { label: "Saccadé / Strobe", description: "Mouvement saccadé style stroboscope" },
  "stop-motion": { description: "Mouvement image par image" },
}

export default map
