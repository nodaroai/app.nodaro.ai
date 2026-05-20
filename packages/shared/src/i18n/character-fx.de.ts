import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Transformation ──
  "auto":              { label: "Automatisch",             description: "Das Modell wählt den Effekt" },
  "none":              { label: "Keiner",                  description: "Kein Charaktereffekt" },
  "werewolf":          { label: "Werwolf",                 description: "Verwandelt sich in einen Werwolf" },
  "vampire":           { label: "Vampir",                  description: "Verwandelt sich in einen Vampir" },
  "cyborg":            { label: "Cyborg-Enthüllung",       description: "Die Haut öffnet sich und enthüllt Kybernetik" },
  "ghost-form":        { label: "Geisterform",             description: "Der Körper wird transluzent und ätherisch" },
  "statue-stone":      { label: "Versteinerung",           description: "Der Körper versteinert zu einer Steinstatue" },
  "liquid-metal":      { label: "Flüssiges Metall",        description: "Flüssige Chrommetall-Form im T-1000-Stil" },
  "animalization":     { label: "Tierverwandlung",         description: "Verwandelt sich in ein Tier" },
  "gorilla-form":      { label: "Gorilla-Form",            description: "Verwandelt sich in einen Gorilla" },
  "mystification":     { label: "Mystifizierung",          description: "Magische Aura umhüllt und verwandelt das Sujet" },
  "gas-form":          { label: "Gasform",                 description: "Der Körper löst sich in Gasform auf" },
  "diamond-skin":      { label: "Diamanthaut",             description: "Der Körper kristallisiert zu Diamantfacetten" },
  "agent-reveal":      { label: "Agenten-Enthüllung",      description: "Anzug und Sonnenbrille materialisieren sich auf dem Sujet" },

  // ── Power ──
  "fire-breathe":      { label: "Feuer Speien",            description: "Atmet einen anhaltenden Feuerstrahl aus" },
  "ice-breathe":       { label: "Eisatem",                 description: "Atmet einen Strahl eiskalter Luft aus" },
  "air-bending":       { label: "Luftkontrolle",           description: "Manipuliert einen wirbelnden Luftvortex" },
  "water-bending":     { label: "Wasserkontrolle",         description: "Manipuliert fließendes Wasser mit Gesten" },
  "earth-bending":     { label: "Erdkontrolle",            description: "Hebt Steinplatten aus dem Boden" },
  "lightning-hands":   { label: "Blitzhände",              description: "Elektrische Lichtbögen schießen aus den Händen" },
  "levitation":        { label: "Levitation",              description: "Erhebt sich vom Boden in vertikaler oder horizontaler Haltung" },
  "telekinesis":       { label: "Telekinese",              description: "Nahe Objekte schweben und kreisen" },
  "invisibility":      { label: "Unsichtbarkeit",          description: "Der Körper verblasst bis zur Transparenz" },
  "hero-flight":       { label: "Heldenflug",              description: "Schießt in heroischer Flugpose in den Himmel" },
  "super-speed":       { label: "Übergeschwindigkeit",     description: "Verwischt zu ultraschneller Bewegung" },
  "soul-departure":    { label: "Seelenabgang",            description: "Eine transluzente Seele erhebt sich aus dem Körper" },

  // ── Body-Mod ──
  "wings-grow":        { label: "Flügel wachsen",          description: "Flügel sprießen und entfalten sich aus dem Rücken" },
  "horns-grow":        { label: "Hörner wachsen",          description: "Hörner dringen aus dem Kopf hervor" },
  "tail-emerge":       { label: "Schwanz wächst",          description: "Ein Schwanz erstreckt sich von der Wirbelsäulenbasis" },
  "tentacles-emerge":  { label: "Tentakel wachsen",        description: "Tentakel schlängeln sich aus dem Rücken oder Körper" },
  "extra-eyes":        { label: "Zusatzaugen öffnen sich", description: "Weitere Augen öffnen sich im Gesicht oder am Körper" },
  "head-explode":      { label: "Kopfexplosion",           description: "Der Kopf explodiert gewaltsam (stilisiert, jugendfrei)" },
  "head-off":          { label: "Kopfabnahme",             description: "Der Kopf löst sich und schwebt frei (stilisiert, jugendfrei)" },
  "spiders-from-mouth":{ label: "Spinnen aus dem Mund",    description: "Spinnen krabbeln aus dem geöffneten Mund (Horror)" },
  "skin-surge":        { label: "Hautwoge",                description: "Die Haut wogt mit Bewegung unter der Oberfläche" },

  // ── Face-Expression ──
  "horror-face":       { label: "Horrorgesicht",           description: "Das Gesicht verzerrt sich zu einem Horrorausdruck" },
  "oni-mask":          { label: "Oni-Maske",               description: "Eine Oni-Dämonenmaske materialisiert sich über dem Gesicht" },
  "glowing-eyes":      { label: "Leuchtende Augen",        description: "Die Augen entzünden sich mit innerem Licht" },
  "floral-eyes":       { label: "Blumenaugen",             description: "Blumen erblühen aus den Augenhöhlen" },
  "bloom-mouth":       { label: "Blütenmund",              description: "Blumen erblühen aus dem geöffneten Mund" },
  "x-ray":             { label: "Röntgen-Enthüllung",      description: "Der Körper wird im Röntgenstil sichtbar und zeigt das Skelett" },
  "agent-snap":        { label: "Sonnenbrille aufs Gesicht", description: "Eine Sonnenbrille schnappt mit einem Klick auf die Augen" },
  "visor-x":           { label: "Cyber-Visier",            description: "Ein futuristisches Cyber-Visier materialisiert sich" },

  // ── Aura-Ambient ──
  "paparazzi":         { label: "Paparazzi-Blitze",        description: "Kamerablitze feuern um das Sujet herum" },
  "money-rain":        { label: "Geldregen",               description: "Geldscheine regnen um das Sujet herum" },
  "color-rain":        { label: "Farbregen",               description: "Leuchtend farbiger Regen um das Sujet herum" },
  "saint-glow":        { label: "Heiligenschein",          description: "Heiligenschein und göttliches Licht strahlen um das Sujet" },
  "fire-aura":         { label: "Feueraura",               description: "Flammen lecken um den Körper des Sujets" },
  "frost-aura":        { label: "Frosthauch",              description: "Raureif und Eis strahlen vom Sujet aus" },
  "shadow-aura":       { label: "Schattenaura",            description: "Dunkle Schattenranken winden sich um das Sujet" },
  "electricity-aura":  { label: "Elektro-Aura",            description: "Tesla-artige elektrische Bögen umgeben das Sujet" },
  "sparkles-around":   { label: "Magische Funken",         description: "Magische Funken kreisen um das Sujet" },
  "fairies-around":    { label: "Feen ringsherum",         description: "Kleine leuchtende Feen flattern um das Sujet herum" },
  "objects-orbit":     { label: "Kreisende Objekte",       description: "Kleine Objekte schweben und kreisen um das Sujet" },
  "petals-around":     { label: "Blütenblätter",           description: "Kirschblütenblätter treiben sanft um das Sujet" },
  "glow-trace":        { label: "Leuchtende Spur",         description: "Leuchtende Spuren folgen der Bewegung des Sujets" },
  "tattoo-animation":  { label: "Tattoo-Animation",        description: "Tätowierungen leuchten und animieren sich auf der Haut" },
}

export default map
