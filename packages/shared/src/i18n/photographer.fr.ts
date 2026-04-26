import type { LocaleCatalogMap } from "./types.js"

// All labels in this catalog are personal proper names — the rule says omit
// the `label` field for proper names; only translate the description.

const map: LocaleCatalogMap = {
  // Editorial / Fashion
  "tim-walker": { description: "Mode féerique picturale" },
  "paolo-roversi": { description: "Lueur Polaroid douce et éthérée" },
  "marta-bevacqua": { description: "Portraits picturaux oniriques" },
  "patrick-demarchelier": { description: "Portrait mode classique raffiné" },
  "nick-knight": { description: "Mode avant-gardiste haute brillance" },
  "mario-testino": { description: "Mode glamour ensoleillée" },
  "steven-meisel": { description: "Édito mid-century soigné" },
  "helmut-newton": { description: "Provocation N&B audacieuse" },
  "mario-sorrenti": { description: "Mode intimiste granuleuse" },
  "annie-leibovitz": { description: "Portrait de célébrité cinématique" },
  "felicia-simion": { description: "Beaux-arts surréalistes pastoraux" },
  "oleg-oprisco": { description: "Narration cinéma à grain de pellicule" },
  "bella-kotak": { description: "Portrait magique fantastique-folklorique" },
  "yigal-ozeri": { description: "Portrait peint hyperréaliste" },
  "jimmy-marble": { description: "Édito pastel candy bright" },
  "rinko-kawauchi": { description: "Quotidien calme baigné de lumière" },
  "ellen-von-unwerth": { description: "Énergie pin-up rétro espiègle" },
  // Documentary / Street
  "henri-cartier-bresson": { description: "Photographie de rue à instant décisif" },
  "vivian-maier": { description: "Rue américaine mid-century" },
  "saul-leiter": { description: "Rue couleur picturale à travers une vitre" },
  "daido-moriyama": { description: "Rue tokyoïte granuleuse à fort contraste" },
  "robert-capa": { description: "Photojournalisme de combat viscéral" },
  "sebastiao-salgado": { description: "Documentaire social monochrome épique" },
  "diane-arbus": { description: "Portrait austère et confrontant" },
  // Cinematographers
  "roger-deakins": { description: "Naturalisme cinéma pictural" },
  "emmanuel-lubezki": { description: "Cinéma flottant en lumière naturelle" },
  "greig-fraser": { description: "Cinéma de genre riche et tactile" },
  "christopher-doyle": { description: "Ambiance néon saturée à main levée" },
  // Concept / Digital Painters
  "greg-rutkowski": { description: "Concept art fantastique pictural épique" },
  "magali-villeneuve": { description: "Art de personnage fantastique héroïque" },
  "charlie-bowater": { description: "Portrait numérique atmosphérique" },
  "sam-spratt": { description: "Portrait hyperréaliste allégorique" },
  "ruan-jia": { description: "Portrait fantastique pictural luxuriant" },
  "ilya-kuvshinov": { description: "Portrait stylisé à influence anime" },
  "wlop": { description: "Portrait fantastique pictural éthéré" },
  "artgerm": { description: "Illustration pinup inspirée de la BD soignée" },
  // Illustrators / Animators
  "makoto-shinkai": { description: "Ciel et lumière anime cinématographiques" },
  "studio-ghibli": { description: "Chaleur Ghibli peinte à la main" },
  "alphonse-mucha": { description: "Panneau décoratif art-nouveau" },
  "carne-griffiths": { description: "Portrait botanique à coulures d'encre" },
  "conrad-roset": { description: "Illustration de figure aquarelle douce" },
  "akihito-yoshida": { description: "Portrait monochrome encre et grain calme" },
  "karol-bak": { description: "Muse peinte symboliste" },
  "ismail-inceoglu": { description: "Paysage pictural mythique" },
  "stefan-gesell": { description: "Portrait sombre surréaliste" },
  "andrew-atroshenko": { description: "Peinture impressionniste romantique de figure" },
  "peter-gric": { description: "Paysage surréaliste architectural" },
  "ingrid-baars": { description: "Collage art-mode sculptural" },
  "guido-van-helten": { description: "Portrait muraliste monumental" },
  "mapplethorpe": { description: "Portrait studio N&B, nus classiques, fleurs" },
  "sherman": { description: "Autoportraits conceptuels, études de personnages" },
  "crewdson": { description: "Banlieue cinématographique, atmosphères angoissantes" },
  "lachapelle": { description: "Surréalisme camp saturé de célébrités" },
  "klein": { description: "Mode tranchante, éclairage dramatique aux ombres marquées" },
  "lindbergh": { description: "Mode N&B minimaliste, beauté brute" },
  "tillmans": { description: "Candid contemporain, intimité queer" },
  "teller": { description: "Mode flash décontractée, anti-glamour" },
  "penn": { description: "Portrait studio mid-century, mode + nature morte" },
}

export default map
