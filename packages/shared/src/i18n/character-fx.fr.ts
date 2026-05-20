import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Transformation ──
  "auto":              { label: "Automatique",             description: "Le modèle choisit l'effet" },
  "none":              { label: "Aucun",                   description: "Pas d'effet de personnage" },
  "werewolf":          { label: "Loup-Garou",              description: "Se transforme en loup-garou" },
  "vampire":           { label: "Vampire",                 description: "Se transforme en vampire" },
  "cyborg":            { label: "Révélation Cyborg",       description: "La peau s'ouvre révélant des implants cybernétiques" },
  "ghost-form":        { label: "Forme Fantôme",           description: "Le corps devient translucide et éthéré" },
  "statue-stone":      { label: "Pétrification",           description: "Le corps se pétrifie en statue de pierre" },
  "liquid-metal":      { label: "Métal Liquide",           description: "Forme de métal chromé liquide style T-1000" },
  "animalization":     { label: "Animalisation",           description: "Se transforme en animal" },
  "gorilla-form":      { label: "Forme Gorille",           description: "Se transforme en gorille" },
  "mystification":     { label: "Mystification",           description: "Une aura magique enveloppe et transforme le sujet" },
  "gas-form":          { label: "Transformation Gazeuse",  description: "Le corps se dissipe sous forme gazeuse" },
  "diamond-skin":      { label: "Peau de Diamant",         description: "Le corps se cristallise en facettes de diamant" },
  "agent-reveal":      { label: "Révélation d'Agent",      description: "Costume et lunettes se matérialisent sur le sujet" },

  // ── Power ──
  "fire-breathe":      { label: "Crache-Feu",              description: "Exhale un jet continu de flammes" },
  "ice-breathe":       { label: "Souffle Glacial",         description: "Exhale un jet d'air glacé" },
  "air-bending":       { label: "Maîtrise de l'Air",       description: "Manipule un vortex tourbillonnant d'air" },
  "water-bending":     { label: "Maîtrise de l'Eau",       description: "Manipule l'eau courante avec des gestes" },
  "earth-bending":     { label: "Maîtrise de la Terre",    description: "Soulève des dalles de pierre du sol" },
  "lightning-hands":   { label: "Mains de Foudre",         description: "Des arcs électriques jaillissent des mains" },
  "levitation":        { label: "Lévitation",              description: "S'élève du sol en position verticale ou horizontale" },
  "telekinesis":       { label: "Télékinésie",             description: "Des objets proches flottent et orbitent" },
  "invisibility":      { label: "Invisibilité",            description: "Le corps s'efface jusqu'à devenir transparent" },
  "hero-flight":       { label: "Vol Héroïque",            description: "Se lance dans le ciel en posture de vol héroïque" },
  "super-speed":       { label: "Vitesse Surhumaine",      description: "Se floute en mouvement ultrarapide" },
  "soul-departure":    { label: "Départ de l'Âme",         description: "Une âme translucide s'élève hors du corps" },

  // ── Body-Mod ──
  "wings-grow":        { label: "Ailes qui Poussent",      description: "Des ailes poussent et se déploient dans le dos" },
  "horns-grow":        { label: "Cornes qui Émergent",     description: "Des cornes sortent de la tête" },
  "tail-emerge":       { label: "Queue qui Émerge",        description: "Une queue s'étend à la base de la colonne vertébrale" },
  "tentacles-emerge":  { label: "Tentacules qui Émergent", description: "Des tentacules serpentent hors du dos ou du corps" },
  "extra-eyes":        { label: "Yeux Supplémentaires",    description: "Des yeux additionnels s'ouvrent sur le visage ou le corps" },
  "head-explode":      { label: "Explosion de Tête",       description: "La tête explose violemment (stylisé, tout public)" },
  "head-off":          { label: "Décapitation",            description: "La tête se détache et flotte (stylisé, tout public)" },
  "spiders-from-mouth":{ label: "Araignées par la Bouche", description: "Des araignées sortent de la bouche ouverte (horreur)" },
  "skin-surge":        { label: "Ondulation de Peau",      description: "La peau ondule avec un mouvement sous la surface" },

  // ── Face-Expression ──
  "horror-face":       { label: "Visage d'Horreur",        description: "Le visage se contorsionne en expression d'horreur" },
  "oni-mask":          { label: "Masque Oni",              description: "Un masque de démon oni se matérialise sur le visage" },
  "glowing-eyes":      { label: "Yeux Lumineux",           description: "Les yeux s'embrasent d'une lumière intérieure" },
  "floral-eyes":       { label: "Yeux Floraux",            description: "Des fleurs éclosent des orbites oculaires" },
  "bloom-mouth":       { label: "Bouche en Fleur",         description: "Des fleurs éclosent de la bouche ouverte" },
  "x-ray":             { label: "Révélation Rayon X",      description: "Le corps devient visible aux rayons X, révélant le squelette" },
  "agent-snap":        { label: "Lunettes Snap-On",        description: "Des lunettes noires se matérialisent sur les yeux" },
  "visor-x":           { label: "Visière Cybernétique",    description: "Une visière cybernétique sci-fi se matérialise" },

  // ── Aura-Ambient ──
  "paparazzi":         { label: "Flashs de Paparazzi",     description: "Des flashs d'appareils photo crépitent autour du sujet" },
  "money-rain":        { label: "Pluie de Billets",        description: "Des billets de banque pleuvent autour du sujet" },
  "color-rain":        { label: "Pluie de Couleurs",       description: "Une pluie de couleurs vives autour du sujet" },
  "saint-glow":        { label: "Aura de Saint",           description: "Un halo et une lumière divine rayonnent autour du sujet" },
  "fire-aura":         { label: "Aura de Feu",             description: "Des flammes lèchent le corps du sujet" },
  "frost-aura":        { label: "Aura de Givre",           description: "Du givre et de la glace irradient depuis le sujet" },
  "shadow-aura":       { label: "Aura d'Ombre",            description: "Des vrilles d'ombre tourbillonnent autour du sujet" },
  "electricity-aura":  { label: "Aura Électrique",         description: "Des arcs électriques façon bobine de Tesla entourent le sujet" },
  "sparkles-around":   { label: "Étincelles Magiques",     description: "Des étincelles magiques orbitent autour du sujet" },
  "fairies-around":    { label: "Fées Alentour",           description: "De petites fées lumineuses virevoltent autour du sujet" },
  "objects-orbit":     { label: "Objets en Orbite",        description: "De petits objets flottent et orbitent autour du sujet" },
  "petals-around":     { label: "Pétales Alentour",        description: "Des pétales de cerisier dérivent doucement autour du sujet" },
  "glow-trace":        { label: "Traînée Lumineuse",       description: "Des traînées lumineuses suivent le mouvement du sujet" },
  "tattoo-animation":  { label: "Tatouages Animés",        description: "Les tatouages brillent et s'animent sur la peau" },
}

export default map
