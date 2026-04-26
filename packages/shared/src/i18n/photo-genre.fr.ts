import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Editorial / Fashion
  "fashion-editorial": { label: "Édito mode", description: "Numéro de magazine de haute couture" },
  "vogue-editorial": { label: "Édito Vogue", description: "Édito de couverture style Vogue" },
  "magazine-cover": { label: "Couverture de magazine", description: "Composition de couverture serrée" },
  "lookbook": { description: "Photo lookbook propre d'une tenue" },
  "ecommerce-flatlay": { label: "Flat lay e-commerce", description: "Vue de dessus produit en flat lay" },
  "beauty-editorial": { label: "Édito beauté", description: "Gros plan macro beauté / soin de la peau" },
  "campaign-advertising": { label: "Campagne / Pub", description: "Image de campagne de marque soignée" },
  // Brand / Editorial Reference
  "brand-vogue": { label: "Signature Vogue", description: "Signature éditoriale du magazine Vogue" },
  "brand-dior": { label: "Signature Dior", description: "Édito Dior — chiaroscuro et silhouette" },
  "brand-jil-sander": { label: "Minimalisme Jil Sander", description: "Jil Sander — architectural minimaliste atténué" },
  "brand-vivienne-tam": { label: "Style Vivienne Tam", description: "Vivienne Tam — mode orientaliste ornée" },
  "brand-jacquemus": { label: "Style Jacquemus", description: "Jacquemus — surréaliste ensoleillé enjoué" },
  "brand-helmut-newton": { label: "Style Helmut Newton", description: "Helmut Newton — provocation N&B à fort contraste" },
  "brand-harpers-bazaar": { label: "Style Harper's Bazaar", description: "Harper's Bazaar — haute couture glacée" },
  // Documentary / Candid
  "paparazzi": { description: "Candid tabloïd au flash délavé" },
  "street-photography": { label: "Photographie de rue", description: "Cadre urbain de rue non posé" },
  "candid-journalism": { label: "Journalisme candide", description: "Moment photojournalistique non posé" },
  "photojournalism": { label: "Photojournalisme", description: "Reportage éditorial de qualité news" },
  "documentary": { label: "Documentaire", description: "Portrait documentaire long-format" },
  "snapshot": { label: "Instantané", description: "Instantané amateur décontracté" },
  // Studio / Formal
  "corporate-headshot": { label: "Portrait corporate", description: "Portrait style LinkedIn" },
  "personal-branding": { label: "Personal branding", description: "Portrait personal-brand moderne" },
  "yearbook": { label: "Album de fin d'année", description: "Portrait scolaire d'album" },
  "id-passport": { label: "ID / Passeport", description: "Photo de passeport réglementaire" },
  "mugshot": { description: "Portrait style anthropométrique policier" },
  "wedding-portrait": { label: "Portrait de mariage", description: "Portrait romantique style nuptial" },
  "family-portrait": { label: "Portrait de famille", description: "Photo de groupe familial posée" },
  "glamour-portrait": { label: "Portrait glamour", description: "Portrait glamour à mise au point douce" },
  "film-noir": { description: "Portrait noir à ombres dures" },
  // Selfie sub-types
  "mirror-selfie": { label: "Selfie miroir", description: "Selfie corps entier dans un miroir" },
  "gym-mirror-selfie": { label: "Selfie miroir de salle de sport", description: "Selfie miroir de vestiaire de gym" },
  "front-cam-selfie": { label: "Selfie caméra frontale", description: "Selfie caméra frontale bras tendu" },
  "bathroom-mirror-selfie": { label: "Selfie miroir de salle de bain", description: "Selfie miroir de salle de bain au flash" },
  "bereal-dual": { label: "BeReal Dual", description: "Cadre simultané avant+arrière" },
  "flip-cam-selfie": { label: "Selfie flip-cam", description: "Flip cam accidentel basse qualité" },
  "group-selfie": { label: "Selfie de groupe", description: "Selfie téléphone à plusieurs sujets" },
  "lofi-baddie-selfie": { label: "Selfie lo-fi 2010", description: "Selfie iPhone basse lumière des débuts" },
  // Print / Context
  "album-cover": { label: "Couverture d'album", description: "Composition de pochette carrée" },
  "movie-poster": { label: "Affiche de film", description: "Affiche cinématographique" },
  "advertising": { label: "Publicité", description: "Photographie publicitaire glacée" },
  "food-photography": { label: "Photographie culinaire", description: "Photo culinaire vue de dessus ou à 45 degrés" },
  "real-estate": { label: "Immobilier", description: "Intérieur architectural large" },
  "sports-action": { label: "Action sportive", description: "Moment sportif figé au téléobjectif" },
}

export default map
