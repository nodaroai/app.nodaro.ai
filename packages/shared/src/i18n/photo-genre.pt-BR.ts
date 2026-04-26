import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Editorial / Fashion
  "fashion-editorial": { label: "Editorial de Moda", description: "Editorial de moda em revista de alta-costura" },
  "vogue-editorial": { label: "Editorial Vogue", description: "Editorial estilo capa da Vogue" },
  "magazine-cover": { label: "Capa de Revista", description: "Composição apertada para capa" },
  "lookbook": { description: "Foto limpa de lookbook" },
  "ecommerce-flatlay": { label: "Flat Lay de E-commerce", description: "Flat lay de produto visto de cima" },
  "beauty-editorial": { label: "Editorial de Beleza", description: "Close de beleza / skincare em macro" },
  "campaign-advertising": { label: "Campanha / Publicidade", description: "Imagem polida de campanha de marca" },

  // Brand / Editorial Reference — most brand names kept as-is
  "brand-vogue": { label: "Estilo Vogue", description: "Assinatura editorial da revista Vogue" },
  "brand-dior": { label: "Estilo Dior", description: "Editorial Dior — chiaroscuro e silhueta" },
  "brand-jil-sander": { label: "Minimalismo Jil Sander", description: "Jil Sander — minimalismo arquitetônico abafado" },
  "brand-vivienne-tam": { label: "Estilo Vivienne Tam", description: "Vivienne Tam — moda orientalista ornamentada" },
  "brand-jacquemus": { label: "Estilo Jacquemus", description: "Jacquemus — surrealismo brincalhão banhado de sol" },
  "brand-helmut-newton": { label: "Estilo Helmut Newton", description: "Helmut Newton — provocação em P&B de alto contraste" },
  "brand-harpers-bazaar": { label: "Estilo Harper's Bazaar", description: "Harper's Bazaar — alta-costura glossy" },

  // Documentary / Candid
  "paparazzi": { description: "Tabloide candid com flash estourado" },
  "street-photography": { label: "Fotografia de Rua", description: "Cena urbana flagrante e sem pose" },
  "candid-journalism": { label: "Jornalismo Espontâneo", description: "Momento não posado de fotojornalismo" },
  "photojournalism": { label: "Fotojornalismo", description: "Reportagem editorial padrão jornal" },
  "documentary": { label: "Documental", description: "Retrato documental de longa duração" },
  "snapshot": { label: "Snapshot", description: "Snapshot amador casual" },

  // Studio / Formal
  "corporate-headshot": { label: "Foto Corporativa", description: "Headshot estilo LinkedIn" },
  "personal-branding": { label: "Personal Branding", description: "Retrato moderno de personal branding" },
  "yearbook": { label: "Foto de Anuário", description: "Retrato de anuário escolar" },
  "id-passport": { label: "Documento / Passaporte", description: "Foto regulamentar de passaporte" },
  "mugshot": { description: "Retrato estilo registro policial" },
  "wedding-portrait": { label: "Retrato de Casamento", description: "Retrato romântico estilo nupcial" },
  "family-portrait": { label: "Retrato de Família", description: "Foto de família posada em grupo" },
  "glamour-portrait": { label: "Retrato Glamour", description: "Retrato glamour com soft focus" },
  "film-noir": { description: "Retrato noir de sombras duras" },

  // Selfie
  "mirror-selfie": { label: "Selfie no Espelho", description: "Selfie de corpo inteiro com celular no espelho" },
  "gym-mirror-selfie": { label: "Selfie no Espelho da Academia", description: "Selfie no espelho do vestiário da academia" },
  "front-cam-selfie": { label: "Selfie com Câmera Frontal", description: "Selfie com a câmera frontal e braço estendido" },
  "bathroom-mirror-selfie": { label: "Selfie no Espelho do Banheiro", description: "Selfie no espelho do banheiro com flash" },
  "bereal-dual": { description: "Duplo frame BeReal: frente + traseira simultâneas" },
  "flip-cam-selfie": { description: "Selfie acidental, baixa qualidade, flip cam" },
  "group-selfie": { label: "Selfie em Grupo", description: "Selfie de celular com várias pessoas" },
  "lofi-baddie-selfie": { label: "Selfie Lo-Fi Anos 2010", description: "Selfie em iPhone antigo com pouca luz" },

  // Print / Context
  "album-cover": { label: "Capa de Álbum", description: "Composição quadrada de capa de álbum" },
  "movie-poster": { label: "Cartaz de Filme", description: "Cartaz teatral cinematográfico" },
  "advertising": { label: "Publicidade", description: "Foto publicitária glossy de campanha" },
  "food-photography": { label: "Fotografia de Comida", description: "Foto de comida vista de cima ou em 45 graus" },
  "real-estate": { label: "Imóveis", description: "Interior arquitetônico em grande angular" },
  "sports-action": { label: "Ação Esportiva", description: "Momento esportivo congelado em telefoto" },
}

export default map
