import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Standard ──
  "auto":                   { label: "Automatisch",              description: "Das Modell wählt den Übergang" },
  "none":                   { label: "Kein / Harter Schnitt",    description: "Sofortiger Schnitt, kein Übergang" },
  "cross-dissolve":         { label: "Überblendung",             description: "Allmähliche Mischung zwischen den Einstellungen" },
  "fade-to-black":          { label: "Abblende auf Schwarz",     description: "Dunkelt auf Schwarz ab, zweite Einstellung erscheint" },
  "fade-to-white":          { label: "Abblende auf Weiß",        description: "Erstrahlt in Weiß, zweite Einstellung erscheint" },
  "match-cut":              { label: "Match Cut",                description: "Form- oder Bewegungsübereinstimmung zwischen Einstellungen" },
  "smash-cut":              { label: "Smash Cut",                description: "Abrupter Schnitt zwischen kontrastierenden Einstellungen" },
  "iris":                   { label: "Irisblende",               description: "Iris schließt und öffnet sich zur zweiten Einstellung" },
  "wipe":                   { label: "Wischblende",              description: "Linearer Wisch ersetzt die erste Einstellung" },
  "roll-transition":        { label: "Rollenübergang",           description: "Bild dreht 90-180°, zweite Einstellung am Ende" },
  "seamless-match":         { label: "Nahtloser Schnitt",        description: "Versteckter Schnitt durch angeglichene Bewegung und Farbe" },

  // ── Time ──
  "fast-forward-day-night": { label: "Zeitraffer Tag → Nacht",  description: "Zeitraffer von Tag zu Nacht in derselben Szene" },
  "fast-forward-night-day": { label: "Zeitraffer Nacht → Tag",  description: "Zeitraffer von Nacht bis Morgengrauen in derselben Szene" },
  "seasonal-shift":         { label: "Jahreszeitenwechsel",     description: "Dieselbe Szene durch wechselnde Jahreszeiten" },
  "aging":                  { label: "Alterung",                description: "Das Sujet altert sichtbar" },
  "rewind":                 { label: "Rückspulen",              description: "Die Zeit läuft zurück, Bewegung spielt rückwärts" },
  "freeze-frame-jump":      { label: "Standbild und Sprung",    description: "Aktion friert ein, springt in der Zeit vor" },
  "weather-shift":          { label: "Wetterwechsel",           description: "Dieselbe Szene bei wechselndem Wetter" },
  "flashback":              { label: "Rückblende",              description: "Erinnerungsrückblende auf einen früheren Moment" },

  // ── Element ──
  "dissolve-to-mist":       { label: "Auflösung in Nebel",      description: "Das Sujet löst sich in Nebel auf und formt sich neu" },
  "water-splash":           { label: "Wasserspritzer",          description: "Das Sujet wird zu Wasser, spritzt und formt sich neu" },
  "sand-scatter":           { label: "Sandstreuung",            description: "Das Sujet wird zu Sand und formt sich neu" },
  "fire-burnup":            { label: "Verbrennung",             description: "Das Sujet verbrennt zu Glut und formt sich neu" },
  "smoke-puff":             { label: "Rauchschwade",            description: "Das Sujet verschwindet im Rauch und erscheint wieder" },
  "magic-sparkles":         { label: "Magische Partikel",       description: "Partikelauflösung im Avengers-Stil" },
  "lightning-flash":        { label: "Blitzschlag",             description: "Ein Blitz schlägt ein, die Szene wechselt im Blitz" },
  "ink-splash":             { label: "Tintenspritzer",          description: "Tinte bedeckt den Rahmen, die Szene wechselt" },
  "sand-storm":             { label: "Sandsturm",               description: "Der Sturm hüllt den Rahmen ein, die Szene wechselt" },
  "paint-splash":           { label: "Farbspritzer",            description: "Farbe bedeckt den Rahmen und enthüllt die neue Szene" },
  "aurora-sweep":           { label: "Nordlichtsweep",          description: "Das Nordlicht durchquert den Rahmen, die Szene wechselt dahinter" },
  "sakura-petals":          { label: "Kirschblütensturm",       description: "Ein Sturm aus Kirschblütenblättern durchquert den Rahmen" },
  "garden-bloom":           { label: "Gartenblüte",             description: "Blumen blühen auf und öffnen sich zur neuen Szene" },
  "powder-burst":           { label: "Pulverexplosion",         description: "Farbiges Pulver explodiert im Rahmen und zerstreut sich" },

  // ── Morph ──
  "liquid-morph":           { label: "Flüssiger Morph",         description: "Das Sujet schmilzt und formt sich zum neuen Sujet" },
  "pixelate-reform":        { label: "Pixelierung und Reform",  description: "Pixeliert, zerstreut und formt sich neu" },
  "shatter-glass":          { label: "Splittern und Reform",    description: "Das Sujet zersplittert wie Glas und formt sich neu" },
  "origami-fold":           { label: "Origami-Faltung",         description: "Das Sujet faltet sich wie Papier zum neuen Sujet" },
  "vortex-swirl":           { label: "Vortex-Wirbel",           description: "Das Sujet spiralt in einen Vortex und entfaltet sich neu" },
  "dream-ripple":           { label: "Traumwelle",              description: "Eine Oberflächenwelle enthüllt die neue Szene" },
  "wireframe-morph":        { label: "Drahtgitter-Morph",       description: "Das Sujet reduziert auf Drahtgitter und formt sich neu" },
  "polygon-shatter":        { label: "Polygonale Splitterung",  description: "Das Sujet splittert in Polygone und setzt sich neu zusammen" },
  "melt-down":              { label: "Schmelze",                description: "Das Sujet schmilzt zur Pfütze und formt sich neu" },

  // ── Portal ──
  "zoom-into-eye":          { label: "Zoom ins Auge",           description: "Die Kamera taucht in die Pupille ein, neue Welt drinnen" },
  "zoom-into-mirror":       { label: "Zoom in den Spiegel",     description: "Die Kamera tritt durch den Spiegel, Szene im Spiegelbild" },
  "zoom-into-screen":       { label: "Zoom in den Bildschirm",  description: "Die Kamera tritt durch den TV- oder Handybildschirm" },
  "zoom-into-book":         { label: "Zoom ins Buch",           description: "Die Kamera taucht in die Buchillustration ein" },
  "walk-through-door":      { label: "Durch die Tür",           description: "Durch die Tür in die neue Szene" },
  "fall-into-hole":         { label: "Fall in die Öffnung",     description: "Die Kamera fällt durch eine Öffnung" },
  "pull-out-reveal":        { label: "Rückzug-Enthüllung",      description: "Enthüllt, dass die Szene ein Bild in einem größeren Kontext war" },
  "zoom-into-mouth":        { label: "Zoom in den Mund",        description: "Die Kamera tritt durch den geöffneten Mund in die neue Welt" },
  "push-through-glass":     { label: "Durch das Glas",          description: "Die Kamera durchquert das Glas in die neue Welt" },
  "soul-jump":              { label: "Seelensprung",            description: "Eine transluzente Seele verlässt den Körper und betritt den neuen" },

  // ── Physics ──
  "explosion-blast":        { label: "Explosionsdruckwelle",    description: "Die Explosion fegt den Rahmen frei, neue Szene erscheint" },
  "shockwave":              { label: "Druckwelle",              description: "Eine Druckwelle durchquert den Rahmen, die Szene wechselt" },
  "punch-into-camera":      { label: "Schlag in die Kamera",    description: "Eine Faust trifft die Kamera, die Szene wechselt" },
  "debris-shower":          { label: "Trümmerregen",            description: "Trümmer fliegen vorbei, dahinter wechselt die Szene" },
  "gravity-flip":           { label: "Gravitationsumkehr",      description: "Die Schwerkraft kehrt sich um, die Kamera dreht 180°" },
  "building-explosion":     { label: "Gebäudeexplosion",        description: "Das Gebäude explodiert, die Szene wechselt im Rauch" },
  "vehicle-explosion":      { label: "Fahrzeugexplosion",       description: "Das Fahrzeug explodiert im Vordergrund, die Szene wechselt" },
  "jump-match":             { label: "Sprung-Schnitt",          description: "Das Sujet springt, die Landung verbindet mit der neuen Szene" },
  "hand-swipe":             { label: "Hand-Wisch",              description: "Eine Hand wischt über das Objektiv, die Szene wechselt dahinter" },

  // ── Light ──
  "white-flash":            { label: "Weißblitz",               description: "Der Rahmen erstrahlt in reinem Weiß" },
  "lens-flare-swipe":       { label: "Flare-Wisch",             description: "Ein anamorphes Lens-Flare fegt über den Rahmen" },
  "light-streak":           { label: "Lichtstreifen",           description: "Ein Lichtstreifen fegt über den Rahmen" },
  "color-invert":           { label: "Farbinversionsblitz",     description: "Die Farben invertieren kurzzeitig" },
  "sun-glare":              { label: "Sonneneinstrahlung",      description: "Starkes Sonnenlicht überstrahlt den Rahmen" },
  "lens-crack":             { label: "Objektivriss",            description: "Das Objektiv reißt, Szene durch das gebrochene Glas" },
  "dirty-lens-wipe":        { label: "Objektivreinigung",       description: "Das schmutzige Objektiv wird gewischt, neue Szene erscheint" },
  "eye-light-burst":        { label: "Augenlichtausbruch",      description: "Ein heller Strahl aus den Augen des Sujets überstrahlt den Rahmen" },

  // ── Glitch ──
  "digital-glitch":         { label: "Digitaler Glitch",        description: "RGB-Split + Scanlines + Datamosh" },
  "vhs-rewind":             { label: "VHS-Rückspulen",          description: "VHS-Tracking-Verzerrung" },
  "datamosh":               { label: "Datamosh",                description: "Bewegungsvektoren bluten zwischen den Szenen" },
  "channel-flip":           { label: "Kanalwechsel",            description: "TV-Kanalwechsel mit Rauschen" },
  "hologram-flicker":       { label: "Hologramm-Flackern",      description: "Holografisches Flackern materialisiert die neue Szene" },
  "display-wipe":           { label: "Display-Wisch",           description: "Die Szene komprimiert zu einem Bildschirm und entfaltet sich" },
  "double-exposure":        { label: "Doppelbelichtung",        description: "Zwei Szenen überlagern sich, die erste blendet aus" },
}

export default map
