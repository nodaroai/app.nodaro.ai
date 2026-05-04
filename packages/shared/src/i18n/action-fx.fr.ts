import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Disaster ──
  "earthquake-tremor": { label: "Tremblement de Terre", description: "Secousse légère, objets suspendus oscillant" },
  "earthquake-major": { label: "Séisme Majeur", description: "Sol qui se fissure, débris qui tombent" },
  "building-collapse": { label: "Effondrement de Bâtiment", description: "Structure s'effondrant en pleine chute" },
  "tsunami-wave": { label: "Vague de Tsunami", description: "Mur d'eau imposant qui s'abat" },
  "tornado": { label: "Tornade", description: "Nuage en entonnoir touchant le sol" },
  "hurricane": { label: "Ouragan", description: "Vents hurlants pliant les arbres, rideaux de pluie" },
  "blizzard-whiteout": { label: "Blizzard Aveuglant", description: "Neige dense effaçant la visibilité" },
  "sandstorm": { label: "Tempête de Sable", description: "Mur de poussière orange engloutissant la scène" },
  "dust-storm-haboob": { label: "Tempête de Poussière (Haboob)", description: "Front imposant de poussière du désert" },
  "wildfire-distant": { label: "Incendie Lointain", description: "Lueur orange et fumée à l'horizon" },
  "wildfire-engulfing": { label: "Incendie Engloutissant", description: "Flammes se rapprochant, miroitement de chaleur intense" },
  "volcanic-eruption": { label: "Éruption Volcanique", description: "Lave jaillissante, panache de cendres" },
  "lava-flow": { label: "Coulée de Lave", description: "Rivière en fusion incandescente avançant sur le sol" },
  "ash-rain": { label: "Pluie de Cendres", description: "Cendres grises apocalyptiques tombant comme de la neige" },
  "avalanche": { label: "Avalanche", description: "Mur de neige dévalant la montagne" },
  "hailstorm": { label: "Orage de Grêle", description: "Gros grêlons rebondissant sur les surfaces" },

  // ── Fire & Blasts ──
  "explosion-small": { label: "Petite Explosion", description: "Détonation compacte avec flash focal" },
  "explosion-large": { label: "Grande Explosion", description: "Boule de feu à l'échelle d'un véhicule avec débris" },
  "explosion-massive": { label: "Explosion Massive", description: "Boule de feu rasant des bâtiments avec onde de choc" },
  "nuclear-detonation": { label: "Détonation Nucléaire", description: "Champignon atomique et flash aveuglant à l'horizon" },
  "fireball-airborne": { label: "Boule de Feu Aérienne", description: "Sphère de flammes roulant dans l'air" },
  "gas-explosion": { label: "Explosion de Gaz", description: "Détonation vive de style propane" },
  "oil-fire": { label: "Feu d'Hydrocarbures", description: "Hautes flammes graisseuses et fumée noire épaisse" },
  "blazing-inferno": { label: "Brasier Ardent", description: "Mur de feu consumant tout" },
  "flame-burst": { label: "Jet de Flamme", description: "Jet de feu directionnel et rapide" },
  "ember-shower": { label: "Pluie de Braises", description: "Cascade de braises orange incandescentes" },
  "smoke-pillar": { label: "Colonne de Fumée", description: "Haute colonne verticale de fumée noire" },
  "mushroom-cloud": { label: "Champignon Atomique", description: "Nuage de détonation classique en dôme et tige" },

  // ── Electric ──
  "lightning-bolt": { label: "Éclair", description: "Décharge ramifiée à travers un ciel orageux" },
  "lightning-strike-impact": { label: "Impact d'Éclair", description: "Éclair frappant le sol avec explosion de lumière" },
  "lightning-storm": { label: "Orage Électrique", description: "Plusieurs décharges simultanées" },
  "ball-lightning": { label: "Foudre en Boule", description: "Orbe brillant de plasma électrique flottant en l'air" },
  "plasma-arc": { label: "Arc Plasma", description: "Arc continu haute tension entre deux points" },
  "taser-sparks": { label: "Étincelles de Taser", description: "Décharge électrique compacte et crépitante au contact" },
  "electric-discharge": { label: "Décharge Électrique", description: "Éclat d'énergie arquée d'un appareil défaillant" },
  "transformer-blowout": { label: "Explosion de Transformateur", description: "Explosion bleu-blanc en haut d'un poteau électrique" },
  "st-elmos-fire": { label: "Feu de Saint-Elme", description: "Inquiétante lueur bleue de plasma sur extrémités métalliques" },
  "static-shock-burst": { label: "Décharge Statique", description: "Petite étincelle d'électricité statique visible" },

  // ── Combat ──
  "muzzle-flash": { label: "Flash de Bouche", description: "Vif flash orange sortant du canon" },
  "gunshot-impact": { label: "Impact de Balle", description: "Balle frappant une surface avec gerbe de débris" },
  "bullet-trail": { label: "Traînée de Balle", description: "Sillage visible d'une balle traversant l'air" },
  "sword-spark": { label: "Étincelles de Lame", description: "Pluie macro d'étincelles de friction métal sur métal" },
  "blade-clash": { label: "Choc de Lames", description: "Deux lames se rencontrant avec onde d'impact" },
  "ricochet-spark": { label: "Étincelle de Ricochet", description: "Balle ricochant sur le métal avec étincelles" },
  "debris-field": { label: "Champ de Débris", description: "Éclats figés en plein vol se dispersant" },
  "glass-shatter-airborne": { label: "Verre Brisé en Vol", description: "Verre explosant en éclats suspendus dans l'air" },
  "shockwave-ground": { label: "Onde de Choc au Sol", description: "Anneau visible s'étendant au niveau du sol" },
  "sonic-boom": { label: "Bang Supersonique", description: "Cône d'air comprimé à vitesse supersonique" },
  "smoke-grenade": { label: "Grenade Fumigène", description: "Épaisse fumée colorée se déployant" },
  "flashbang": { label: "Grenade Aveuglante", description: "Éclat aveuglant de lumière blanche" },
  "blood-spray": { label: "Gerbe de Sang", description: "Arc cinématographique de gouttes de sang" },
  "arrow-hit-spark": { label: "Étincelles d'Impact de Flèche", description: "Flèche se plantant avec petites étincelles à l'impact" },

  // ── Sci-Fi ──
  "laser-blast": { label: "Tir Laser", description: "Faisceau cohérent et brillant d'énergie" },
  "energy-beam": { label: "Rayon d'Énergie", description: "Large faisceau pulsant d'énergie plasmique" },
  "plasma-bolt": { label: "Tir de Plasma", description: "Projectile brillant laissant une traînée de vapeur" },
  "force-field-shimmer": { label: "Miroitement de Champ de Force", description: "Barrière énergétique translucide à motif hexagonal" },
  "force-field-impact": { label: "Impact sur Champ de Force", description: "Onde visible là où le projectile heurte le bouclier" },
  "portal-opening": { label: "Ouverture de Portail", description: "Vortex tourbillonnant d'énergie déchirant l'espace" },
  "warp-distortion": { label: "Distorsion Warp", description: "Espace-temps se courbant autour d'un objet" },
  "hologram-flicker": { label: "Hologramme Vacillant", description: "Projection translucide qui glitch" },
  "ion-storm": { label: "Tempête Ionique", description: "Champ crépitant de particules chargées sur fond cosmique" },
  "antimatter-flash": { label: "Flash d'Antimatière", description: "Éclat d'énergie pure blanche déchirant la réalité" },

  // ── Magic ──
  "fireball-spell": { label: "Sort Boule de Feu", description: "Orbe de feu tourbillonnant lancée à la main" },
  "magic-aura": { label: "Aura Magique", description: "Halo lumineux d'énergie autour d'une figure" },
  "summoning-glyph": { label: "Glyphe d'Invocation", description: "Cercle magique lumineux au sol" },
  "lightning-magic": { label: "Magie de Foudre", description: "Sorcellerie électrique jaillissant des mains du lanceur" },
  "ice-shard-burst": { label: "Éclat d'Échardes de Glace", description: "Esquilles cristallines projetées vers l'extérieur" },
  "energy-rune": { label: "Rune d'Énergie", description: "Symbole arcanique brillant suspendu dans l'air" },
  "portal-magic": { label: "Portail Magique", description: "Porte mystique tourbillonnante dans l'espace" },
  "healing-glow": { label: "Lueur de Guérison", description: "Chaude lumière dorée émanant du lanceur" },
  "dark-vortex": { label: "Vortex Sombre", description: "Vide tourbillonnant noir et violet menaçant" },
  "light-explosion": { label: "Explosion de Lumière", description: "Éclat de pure radiance blanc-or" },
}

export default map
