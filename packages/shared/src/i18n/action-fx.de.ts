import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Disaster ──
  "earthquake-tremor": { label: "Erdbeben (leicht)", description: "Leichtes Beben, hängende Objekte schwanken" },
  "earthquake-major": { label: "Schweres Erdbeben", description: "Aufreißender Boden, herabstürzende Trümmer" },
  "building-collapse": { label: "Gebäudeeinsturz", description: "Bauwerk zerbricht im Fall" },
  "tsunami-wave": { label: "Tsunami-Welle", description: "Hereinstürzende Wand aus Wasser" },
  "tornado": { label: "Tornado", description: "Trichterwolke berührt den Boden" },
  "hurricane": { label: "Hurrikan", description: "Heulende Winde, gebogene Bäume, Regenschleier" },
  "blizzard-whiteout": { label: "Schneesturm-Whiteout", description: "Dichter Schnee löscht die Sicht aus" },
  "sandstorm": { label: "Sandsturm", description: "Wand aus orangefarbenem Staub verschluckt die Szene" },
  "dust-storm-haboob": { label: "Staubsturm (Haboob)", description: "Hochaufragende Wüsten-Staubfront" },
  "wildfire-distant": { label: "Ferner Waldbrand", description: "Oranges Glühen + Rauch am Horizont" },
  "wildfire-engulfing": { label: "Verschlingender Waldbrand", description: "Flammen rücken näher, intensives Hitzeflimmern" },
  "volcanic-eruption": { label: "Vulkanausbruch", description: "Aufsteigende Lava, Aschewolke" },
  "lava-flow": { label: "Lavastrom", description: "Glühender geschmolzener Strom kriecht über den Boden" },
  "ash-rain": { label: "Aschefall", description: "Apokalyptische graue Asche fällt wie Schnee" },
  "avalanche": { label: "Lawine", description: "Schneewand stürzt den Berghang hinunter" },
  "hailstorm": { label: "Hagelsturm", description: "Große Hagelkörner prallen von Oberflächen ab" },

  // ── Fire & Blasts ──
  "explosion-small": { label: "Kleine Explosion", description: "Kompakte Detonation mit Lichtblitz im Zentrum" },
  "explosion-large": { label: "Große Explosion", description: "Feuerball in Fahrzeuggröße mit umherfliegenden Trümmern" },
  "explosion-massive": { label: "Massive Explosion", description: "Gebäudezerschmetternder Feuerball mit Druckwelle" },
  "nuclear-detonation": { label: "Nukleare Detonation", description: "Atompilz und horizonterhellender Lichtblitz" },
  "fireball-airborne": { label: "Schwebender Feuerball", description: "Rollende Feuerkugel in der Luft" },
  "gas-explosion": { label: "Gasexplosion", description: "Heller Propan-artiger Lichtblitz" },
  "oil-fire": { label: "Ölbrand", description: "Hohe fettige Flammen + dichter schwarzer Rauch" },
  "blazing-inferno": { label: "Loderndes Inferno", description: "Feuerwand verschlingt alles" },
  "flame-burst": { label: "Flammenstoß", description: "Schneller gerichteter Flammenstrahl" },
  "ember-shower": { label: "Funkenflug", description: "Kaskade glühender oranger Funken" },
  "smoke-pillar": { label: "Rauchsäule", description: "Hohe vertikale Säule aus schwarzem Rauch" },
  "mushroom-cloud": { label: "Atompilz", description: "Klassische Detonationswolke aus Stiel und Kuppel" },

  // ── Electric ──
  "lightning-bolt": { label: "Blitz", description: "Verzweigte Entladung am Sturmhimmel" },
  "lightning-strike-impact": { label: "Blitzeinschlag", description: "Blitz schlägt in den Boden mit Lichtexplosion" },
  "lightning-storm": { label: "Gewittersturm", description: "Mehrere gleichzeitige Einschläge" },
  "ball-lightning": { label: "Kugelblitz", description: "Glühender Plasma-Orb schwebt in der Luft" },
  "plasma-arc": { label: "Plasmabogen", description: "Hochspannungs-Dauerlichtbogen zwischen zwei Punkten" },
  "taser-sparks": { label: "Taser-Funken", description: "Kompakte knisternde elektrische Entladung beim Kontakt" },
  "electric-discharge": { label: "Elektrische Entladung", description: "Schauer aus Lichtbögen aus einem defekten Gerät" },
  "transformer-blowout": { label: "Transformator-Explosion", description: "Blau-weiße Explosion auf einem Strommast" },
  "st-elmos-fire": { label: "Elmsfeuer", description: "Unheimliches blaues Plasmaglühen an Metallspitzen" },
  "static-shock-burst": { label: "Statikentladung", description: "Winziger sichtbarer Funken statischer Elektrizität" },

  // ── Combat ──
  "muzzle-flash": { label: "Mündungsfeuer", description: "Heller orangefarbener Blitz aus dem Gewehrlauf" },
  "gunshot-impact": { label: "Schuss-Einschlag", description: "Kugel trifft Oberfläche mit Trümmer-Auswurf" },
  "bullet-trail": { label: "Geschossspur", description: "Sichtbarer Streif einer Kugel durch die Luft" },
  "sword-spark": { label: "Klingenfunken", description: "Makro-Schauer aus Reibungsfunken Metall auf Metall" },
  "blade-clash": { label: "Klingenstoß", description: "Zwei Klingen treffen mit Schockwelle aufeinander" },
  "ricochet-spark": { label: "Querschläger-Funken", description: "Kugel prallt von Metall mit Funkenflug ab" },
  "debris-field": { label: "Trümmerfeld", description: "In der Luft erstarrende Splitter zerstreuen sich" },
  "glass-shatter-airborne": { label: "Glas zerspringt im Flug", description: "Glas explodiert nach außen in Splittern in der Luft" },
  "shockwave-ground": { label: "Druckwelle am Boden", description: "Sichtbarer expandierender Ring auf Bodenhöhe" },
  "sonic-boom": { label: "Überschallknall", description: "Kegel komprimierter Luft bei Überschallgeschwindigkeit" },
  "smoke-grenade": { label: "Rauchgranate", description: "Dichter farbiger Rauch breitet sich nach außen aus" },
  "flashbang": { label: "Blendgranate", description: "Blendender weißer Lichtblitz" },
  "blood-spray": { label: "Blutsprenkel", description: "Filmreifer Bogen aus Bluttropfen" },
  "arrow-hit-spark": { label: "Pfeil-Einschlagfunken", description: "Pfeil trifft mit kleinen Funken am Aufprall ein" },

  // ── Sci-Fi ──
  "laser-blast": { label: "Laserstrahl", description: "Heller kohärenter Energiestrahl" },
  "energy-beam": { label: "Energiestrahl", description: "Breiter pulsierender Plasma-Energiestrahl" },
  "plasma-bolt": { label: "Plasmageschoss", description: "Glühendes Projektil mit Dampfschweif" },
  "force-field-shimmer": { label: "Kraftfeld-Schimmer", description: "Durchscheinende Energiebarriere mit Hex-Muster" },
  "force-field-impact": { label: "Kraftfeld-Aufprall", description: "Sichtbare Welle dort, wo das Geschoss den Schild trifft" },
  "portal-opening": { label: "Portalöffnung", description: "Wirbelnder Energievortex reißt den Raum auf" },
  "warp-distortion": { label: "Warp-Verzerrung", description: "Raumzeit krümmt sich um ein Objekt" },
  "hologram-flicker": { label: "Hologramm-Flackern", description: "Durchscheinende Projektion glitcht" },
  "ion-storm": { label: "Ionensturm", description: "Knisterndes Feld geladener Teilchen vor kosmischer Kulisse" },
  "antimatter-flash": { label: "Antimaterie-Blitz", description: "Realitäts-zerreißender Stoß reiner weißer Energie" },

  // ── Magic ──
  "fireball-spell": { label: "Feuerball-Zauber", description: "Mit der Hand geworfener Wirbel aus Feuer" },
  "magic-aura": { label: "Magische Aura", description: "Glühender Energie-Halo um eine Figur" },
  "summoning-glyph": { label: "Beschwörungsglyphe", description: "Glühender magischer Kreis am Boden" },
  "lightning-magic": { label: "Blitzmagie", description: "Elektrische Zauberei aus den Händen des Magiers" },
  "ice-shard-burst": { label: "Eissplitter-Stoß", description: "Kristalline Splitter spritzen nach außen" },
  "energy-rune": { label: "Energierune", description: "Glühendes arkanes Symbol schwebt in der Luft" },
  "portal-magic": { label: "Magisches Portal", description: "Wirbelndes mystisches Tor im Raum" },
  "healing-glow": { label: "Heilungsschein", description: "Warmes goldenes Licht strömt vom Zaubernden aus" },
  "dark-vortex": { label: "Dunkler Vortex", description: "Bedrohlicher schwarz-violetter Wirbelschlund" },
  "light-explosion": { label: "Lichtexplosion", description: "Blitz aus reinem weiß-goldenem Strahlen" },
}

export default map
