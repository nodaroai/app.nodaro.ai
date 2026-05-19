import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Standard ──
  "auto":                   { label: "Automatique",              description: "Le modèle choisit la transition" },
  "none":                   { label: "Aucune / Coupe Sèche",     description: "Coupe instantanée, sans transition" },
  "cross-dissolve":         { label: "Fondu Enchaîné",           description: "Mélange progressif entre les plans" },
  "fade-to-black":          { label: "Fondu au Noir",            description: "S'assombrit, le second plan émerge du noir" },
  "fade-to-white":          { label: "Fondu au Blanc",           description: "Sature de blanc, le second plan en émerge" },
  "match-cut":              { label: "Coupe sur Raccord",        description: "Correspondance de forme ou mouvement entre plans" },
  "smash-cut":              { label: "Coupe Violente",           description: "Coupe abrupte entre plans contrastés" },
  "iris":                   { label: "Cache Iris",               description: "L'iris ferme puis ouvre sur le second plan" },
  "wipe":                   { label: "Balayage",                 description: "Balayage linéaire remplace le premier plan" },
  "roll-transition":        { label: "Rotation",                 description: "Le cadre pivote 90-180°, second plan à l'arrivée" },
  "seamless-match":         { label: "Coupe Invisible",          description: "Coupe masquée par mouvement et couleur synchronisés" },

  // ── Time ──
  "fast-forward-day-night": { label: "Accéléré Jour → Nuit",    description: "Accéléré de jour à nuit sur la même scène" },
  "fast-forward-night-day": { label: "Accéléré Nuit → Jour",    description: "Accéléré de nuit à l'aube sur la même scène" },
  "seasonal-shift":         { label: "Glissement Saisonnier",   description: "La même scène à travers les saisons" },
  "aging":                  { label: "Vieillissement",           description: "Le sujet vieillit visiblement" },
  "rewind":                 { label: "Rembobinage",              description: "Le temps recule, le mouvement joue à l'envers" },
  "freeze-frame-jump":      { label: "Image Gelée et Saut",      description: "L'action se fige, saute en avant dans le temps" },
  "weather-shift":          { label: "Changement Météo",         description: "La même scène sous différentes météos" },
  "flashback":              { label: "Flashback",                description: "Retour en mémoire vers un moment passé du sujet" },

  // ── Element ──
  "dissolve-to-mist":       { label: "Dissolution en Brume",    description: "Le sujet se dissout en brume puis se reforme" },
  "water-splash":           { label: "Éclaboussure d'Eau",      description: "Le sujet devient eau, éclabousse et se reforme" },
  "sand-scatter":           { label: "Dispersion de Sable",     description: "Le sujet devient sable et se reforme" },
  "fire-burnup":            { label: "Combustion",              description: "Le sujet brûle en braises et se reforme" },
  "smoke-puff":             { label: "Bouffée de Fumée",        description: "Le sujet disparaît dans la fumée et réapparaît" },
  "magic-sparkles":         { label: "Particules Magiques",     description: "Dissolution en particules style Avengers" },
  "lightning-flash":        { label: "Éclair",                  description: "Un éclair frappe, la scène change dans le flash" },
  "ink-splash":             { label: "Éclaboussure d'Encre",    description: "L'encre couvre le cadre, la scène change" },
  "sand-storm":             { label: "Tempête de Sable",        description: "La tempête enveloppe le cadre, la scène change" },
  "paint-splash":           { label: "Éclaboussure de Peinture", description: "La peinture couvre le cadre et révèle la nouvelle scène" },
  "aurora-sweep":           { label: "Balayage d'Aurore",       description: "L'aurore traverse le cadre, la scène change derrière" },
  "sakura-petals":          { label: "Tempête de Sakura",       description: "Une tempête de pétales de cerisier traverse le cadre" },
  "garden-bloom":           { label: "Floraison du Jardin",     description: "Des fleurs éclosent et s'ouvrent sur la nouvelle scène" },
  "powder-burst":           { label: "Explosion de Poudre",     description: "De la poudre colorée explose dans le cadre et se dissipe" },

  // ── Morph ──
  "liquid-morph":           { label: "Morphose Liquide",        description: "Le sujet fond et se reforme en nouveau sujet" },
  "pixelate-reform":        { label: "Pixellisation et Reforme", description: "Se pixellise, se disperse et se reforme" },
  "shatter-glass":          { label: "Brisure et Reforme",      description: "Le sujet se brise comme du verre et se reforme" },
  "origami-fold":           { label: "Pliage Origami",          description: "Le sujet se plie comme du papier en nouveau sujet" },
  "vortex-swirl":           { label: "Tourbillon Vortex",       description: "Le sujet tourbillonne en vortex et se déploie" },
  "dream-ripple":           { label: "Ondulation Onirique",     description: "Une ondulation de surface révèle la nouvelle scène" },
  "wireframe-morph":        { label: "Morphose Fil de Fer",     description: "Le sujet réduit à une maille et se reforme" },
  "polygon-shatter":        { label: "Fragmentation Polygonale", description: "Le sujet se fragmente en polygones et se réassemble" },
  "melt-down":              { label: "Fonte",                   description: "Le sujet fond en flaque et se reforme" },

  // ── Portal ──
  "zoom-into-eye":          { label: "Zoom dans l'Œil",         description: "La caméra plonge dans la pupille, nouveau monde intérieur" },
  "zoom-into-mirror":       { label: "Zoom dans le Miroir",     description: "La caméra pénètre le miroir, scène dans le reflet" },
  "zoom-into-screen":       { label: "Zoom dans l'Écran",       description: "La caméra pénètre l'écran TV ou téléphone" },
  "zoom-into-book":         { label: "Zoom dans le Livre",      description: "La caméra plonge dans l'illustration du livre" },
  "walk-through-door":      { label: "Franchir la Porte",       description: "À travers la porte vers la nouvelle scène" },
  "fall-into-hole":         { label: "Chute dans le Trou",      description: "La caméra tombe par une ouverture" },
  "pull-out-reveal":        { label: "Recul Révélateur",        description: "Révèle que la scène était une image dans un contexte plus grand" },
  "zoom-into-mouth":        { label: "Zoom dans la Bouche",     description: "La caméra pénètre la bouche ouverte vers le nouveau monde" },
  "push-through-glass":     { label: "Traversée du Verre",      description: "La caméra traverse le verre vers le nouveau monde" },
  "soul-jump":              { label: "Saut d'Âme",              description: "Une âme translucide quitte le corps et entre dans le nouveau" },

  // ── Physics ──
  "explosion-blast":        { label: "Souffle d'Explosion",     description: "L'explosion balaie le cadre, la nouvelle scène émerge" },
  "shockwave":              { label: "Onde de Choc",            description: "Une onde de choc traverse le cadre, la scène change" },
  "punch-into-camera":      { label: "Coup dans la Caméra",     description: "Un poing frappe la caméra, la scène change" },
  "debris-shower":          { label: "Pluie de Débris",         description: "Des débris volent devant, la scène change derrière" },
  "gravity-flip":           { label: "Inversion de Gravité",    description: "La gravité s'inverse, la caméra pivote de 180°" },
  "building-explosion":     { label: "Explosion de Bâtiment",   description: "La structure explose, la scène change dans la fumée" },
  "vehicle-explosion":      { label: "Explosion de Véhicule",   description: "Le véhicule explose au premier plan, la scène change" },
  "jump-match":             { label: "Raccord de Saut",         description: "Le sujet saute, l'atterrissage enchaîne sur la nouvelle scène" },
  "hand-swipe":             { label: "Balayage de Main",        description: "Une main balaie l'objectif, la scène change en se dégageant" },

  // ── Light ──
  "white-flash":            { label: "Flash Blanc",             description: "Le cadre sature en blanc pur" },
  "lens-flare-swipe":       { label: "Balayage de Flare",       description: "Un flare anamorphique traverse le cadre" },
  "light-streak":           { label: "Traînée Lumineuse",       description: "Une traînée de lumière balaie le cadre" },
  "color-invert":           { label: "Flash de Couleurs Inversées", description: "Les couleurs s'inversent brièvement" },
  "sun-glare":              { label: "Éblouissement Solaire",   description: "L'éblouissement du soleil sature le cadre" },
  "lens-crack":             { label: "Fissure d'Objectif",      description: "L'objectif se fissure, la scène à travers le verre brisé" },
  "dirty-lens-wipe":        { label: "Nettoyage d'Objectif",    description: "L'objectif sale est essuyé, révélant la nouvelle scène" },
  "eye-light-burst":        { label: "Éclat Oculaire",          description: "Un faisceau brillant depuis les yeux du sujet sature le cadre" },

  // ── Glitch ──
  "digital-glitch":         { label: "Glitch Numérique",        description: "Corruption RGB + scanlines + datamosh" },
  "vhs-rewind":             { label: "Rembobinage VHS",         description: "Distorsion de tracking VHS" },
  "datamosh":               { label: "Datamosh",                description: "Les vecteurs de mouvement saignent entre les scènes" },
  "channel-flip":           { label: "Zapping TV",              description: "Changement de chaîne avec parasites" },
  "hologram-flicker":       { label: "Scintillement d'Hologramme", description: "Scintillement holographique matérialise la nouvelle scène" },
  "display-wipe":           { label: "Balayage d'Écran",        description: "La scène se comprime dans un écran puis s'étend" },
  "double-exposure":        { label: "Double Exposition",       description: "Deux scènes se superposent, la première disparaît" },
}

export default map
