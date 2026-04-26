import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Basic
  "auto": { label: "Auto", description: "Laisser le modèle choisir le mouvement de caméra approprié" },
  "static": { label: "Statique", description: "Caméra fixe, aucun mouvement" },
  "handheld": { label: "Caméra à l'épaule", description: "Tremblement naturel à l'épaule" },
  "steadicam": { label: "Steadicam", description: "Plan stabilisé fluide en marche" },
  // Pan
  "pan-left": { label: "Panoramique à gauche", description: "Pivoter la caméra horizontalement vers la gauche" },
  "pan-right": { label: "Panoramique à droite", description: "Pivoter la caméra horizontalement vers la droite" },
  "whip-pan-left": { label: "Panoramique fouetté à gauche", description: "Panoramique rapide vers la gauche avec flou de mouvement" },
  "whip-pan-right": { label: "Panoramique fouetté à droite", description: "Panoramique rapide vers la droite avec flou de mouvement" },
  // Tilt
  "tilt-up": { label: "Inclinaison vers le haut", description: "Incliner la caméra vers le haut" },
  "tilt-down": { label: "Inclinaison vers le bas", description: "Incliner la caméra vers le bas" },
  // Zoom
  "zoom-in": { label: "Zoom avant", description: "Zoom de l'objectif vers le sujet" },
  "zoom-out": { label: "Zoom arrière", description: "Zoom de l'objectif s'éloignant du sujet" },
  "crash-zoom-in": { label: "Crash zoom avant", description: "Zoom avant rapide de type fouet" },
  "crash-zoom-out": { label: "Crash zoom arrière", description: "Zoom arrière rapide de type fouet" },
  // Dolly
  "dolly-in": { label: "Travelling avant", description: "Pousser la caméra vers le sujet (parallaxe)" },
  "dolly-out": { label: "Travelling arrière", description: "Reculer la caméra (parallaxe)" },
  "dolly-zoom": { description: "Effet vertigo : travelling opposé au zoom" },
  "push-in": { label: "Push in", description: "Poussée subtile et lente vers le sujet" },
  "pull-out": { label: "Pull out", description: "Recul subtil et lent depuis le sujet" },
  // Truck
  "truck-left": { label: "Travelling latéral à gauche", description: "Glisser le corps de la caméra latéralement à gauche" },
  "truck-right": { label: "Travelling latéral à droite", description: "Glisser le corps de la caméra latéralement à droite" },
  // Pedestal
  "pedestal-up": { label: "Pédestal montant", description: "Élever verticalement le corps de la caméra" },
  "pedestal-down": { label: "Pédestal descendant", description: "Abaisser verticalement le corps de la caméra" },
  // Roll
  "roll-left": { label: "Roulis à gauche", description: "Pivoter la caméra dans le sens antihoraire" },
  "roll-right": { label: "Roulis à droite", description: "Pivoter la caméra dans le sens horaire" },
  "dutch-angle": { description: "Cadre incliné statique pour la tension" },
  // Orbit
  "orbit-left": { label: "Orbite à gauche", description: "Cercle complet autour du sujet vers la gauche" },
  "orbit-right": { label: "Orbite à droite", description: "Cercle complet autour du sujet vers la droite" },
  "arc-left": { label: "Arc à gauche", description: "Arc partiel autour du sujet à gauche" },
  "arc-right": { label: "Arc à droite", description: "Arc partiel autour du sujet à droite" },
  // Crane
  "crane-up": { label: "Grue montante", description: "Élévation de grue révélant la scène" },
  "crane-down": { label: "Grue descendante", description: "Descente de grue balayante" },
  "boom-up": { label: "Bras montant", description: "Élévation du bras de grue" },
  "boom-down": { label: "Bras descendant", description: "Descente du bras de grue" },
  // Tracking
  "tracking-shot": { label: "Plan de poursuite", description: "La caméra suit le sujet en mouvement à ses côtés" },
  "follow": { label: "Suivi", description: "Suivre le sujet par derrière" },
  "lead": { label: "Précéder", description: "Avancer devant le sujet qui avance" },
  "drone-follow": { label: "Suivi par drone", description: "Drone élevé suivant le sujet" },
  "dolly-track": { description: "Travelling sur rail parallèle au sujet" },
  // Special
  "pov": { label: "POV", description: "Point de vue à la première personne" },
  "over-the-shoulder": { label: "Par-dessus l'épaule", description: "Cadrer par-dessus l'épaule d'un personnage" },
  "birds-eye": { label: "Vue d'oiseau", description: "Vue plongeante directe de dessus" },
  "worms-eye": { label: "Vue de ver", description: "Plan en contre-plongée extrême vers le haut" },
  "aerial": { label: "Aérien", description: "Plan style drone à haute altitude" },
  "helicopter": { label: "Hélicoptère", description: "Plan aérien large balayant à haute altitude" },
  "fly-over": { label: "Survol", description: "Passage aérien rapide et bas au-dessus de la scène" },
  "flythrough": { label: "Traversée volante", description: "La caméra traverse l'espace en volant" },
  "reveal": { label: "Révélation", description: "Révélation progressive d'une scène plus large" },
  "snorricam": { description: "Caméra montée sur le corps (sujet verrouillé dans le cadre)" },
  "rack-focus": { description: "Tirer la mise au point entre premier plan et arrière-plan" },
  "handheld-vlog": { label: "Vlog à l'épaule", description: "Caméra à l'épaule décontractée style vlog" },
  "pov-walk": { label: "Marche en POV", description: "POV de marche à la première personne" },
  "velocity-edit": { description: "Cadence en speed-ramp style TikTok" },
  "match-cut-zoom": { description: "Zoom synchronisé sur un beat pour des coupes" },
  "screen-tap": { description: "Transition tap à l'écran à l'image" },
  "phone-flip": { description: "Bascule entre caméra avant et arrière" },
}

export default map
