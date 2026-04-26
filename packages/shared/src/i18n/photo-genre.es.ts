import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Editorial / Fashion --------------------
  "fashion-editorial": { label: "Editorial de Moda", description: "Doble página de revista de alta moda" },
  "vogue-editorial": { label: "Editorial Vogue", description: "Editorial de portada estilo Vogue" },
  "magazine-cover": { label: "Portada de Revista", description: "Composición de portada con encuadre cerrado" },
  "lookbook": { label: "Lookbook", description: "Foto limpia de outfit de lookbook" },
  "ecommerce-flatlay": { label: "Flat Lay de E-commerce", description: "Flat lay cenital de producto" },
  "beauty-editorial": { label: "Editorial de Belleza", description: "Primer plano macro de belleza/skincare" },
  "campaign-advertising": { label: "Campaña / Anuncio", description: "Imagen pulida de campaña de marca" },

  // -------------------- Brand / Editorial Reference --------------------
  "brand-vogue": { label: "Sello Vogue", description: "Sello editorial de revista Vogue" },
  "brand-dior": { label: "Sello Dior", description: "Editorial Dior — chiaroscuro y silueta" },
  "brand-jil-sander": { label: "Minimalismo Jil Sander", description: "Jil Sander — arquitectónico minimalista apagado" },
  "brand-vivienne-tam": { label: "Estilo Vivienne Tam", description: "Vivienne Tam — moda orientalista ornamentada" },
  "brand-jacquemus": { label: "Estilo Jacquemus", description: "Jacquemus — bañado por el sol surrealista juguetón" },
  "brand-helmut-newton": { label: "Estilo Helmut Newton", description: "Helmut Newton — provocación B&N de alto contraste" },
  "brand-harpers-bazaar": { label: "Estilo Harper's Bazaar", description: "Harper's Bazaar — alta moda brillante" },

  // -------------------- Documentary / Candid --------------------
  "paparazzi": { label: "Paparazzi", description: "Candid de tabloide con flash quemado" },
  "street-photography": { label: "Fotografía Callejera", description: "Cuadro callejero urbano sin pose" },
  "candid-journalism": { label: "Periodismo Candid", description: "Momento fotoperiodístico sin pose" },
  "photojournalism": { label: "Fotoperiodismo", description: "Reportaje editorial de calidad noticiosa" },
  "documentary": { label: "Documental", description: "Retrato documental de larga duración" },
  "snapshot": { label: "Instantánea", description: "Instantánea aficionada casual" },

  // -------------------- Studio / Formal --------------------
  "corporate-headshot": { label: "Headshot Corporativo", description: "Headshot estilo LinkedIn" },
  "personal-branding": { label: "Branding Personal", description: "Retrato moderno de marca personal" },
  "yearbook": { label: "Anuario", description: "Retrato de anuario escolar" },
  "id-passport": { label: "ID / Pasaporte", description: "Foto de pasaporte reglamentaria" },
  "mugshot": { label: "Foto Policial", description: "Retrato estilo ficha policial" },
  "wedding-portrait": { label: "Retrato de Boda", description: "Retrato romántico estilo nupcial" },
  "family-portrait": { label: "Retrato Familiar", description: "Foto grupal familiar posada" },
  "glamour-portrait": { label: "Retrato de Glamour", description: "Retrato de glamour con foco suave" },
  "film-noir": { label: "Cine Noir", description: "Retrato noir con sombras duras" },

  // -------------------- Selfie sub-types --------------------
  "mirror-selfie": { label: "Selfie en Espejo", description: "Selfie de cuerpo entero con teléfono en espejo" },
  "gym-mirror-selfie": { label: "Selfie en Espejo de Gimnasio", description: "Selfie en espejo de vestuario de gimnasio" },
  "front-cam-selfie": { label: "Selfie de Cámara Frontal", description: "Selfie con brazo extendido y cámara frontal" },
  "bathroom-mirror-selfie": { label: "Selfie en Espejo de Baño", description: "Selfie en espejo de baño con flash" },
  "bereal-dual": { label: "BeReal Dual", description: "Cuadro dual frontal+trasero simultáneo" },
  "flip-cam-selfie": { label: "Selfie Flip-Cam", description: "Flip cam accidental de baja calidad" },
  "group-selfie": { label: "Selfie Grupal", description: "Selfie grupal con teléfono" },
  "lofi-baddie-selfie": { label: "Selfie Lo-Fi de los 2010s", description: "Selfie de iPhone temprano con poca luz" },

  // -------------------- Print / Context --------------------
  "album-cover": { label: "Portada de Álbum", description: "Composición cuadrada de portada de álbum" },
  "movie-poster": { label: "Póster de Película", description: "Póster cinematográfico de teatro" },
  "advertising": { label: "Publicidad", description: "Fotografía publicitaria brillante" },
  "food-photography": { label: "Fotografía de Comida", description: "Foto cenital o a 45 grados de comida" },
  "real-estate": { label: "Inmobiliaria", description: "Interior arquitectónico amplio" },
  "sports-action": { label: "Acción Deportiva", description: "Momento deportivo congelado con telefoto" },
}

export default map
