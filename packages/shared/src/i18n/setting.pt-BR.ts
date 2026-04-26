import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Indoor
  "coffee-shop": { label: "Cafeteria", description: "Interior aconchegante de cafeteria" },
  "library": { label: "Biblioteca", description: "Biblioteca grandiosa com estantes altas" },
  "office": { label: "Escritório Moderno", description: "Escritório moderno claro e envidraçado" },
  "home-office": { label: "Home Office", description: "Espaço de trabalho aconchegante em casa" },
  "bedroom": { label: "Quarto", description: "Quarto íntimo" },
  "living-room": { label: "Sala de Estar", description: "Sala de estar residencial e aconchegante" },
  "kitchen": { label: "Cozinha", description: "Cozinha de casa quente com luz da manhã" },
  "hotel-room": { label: "Quarto de Hotel", description: "Quarto de hotel elegante com vista da cidade" },
  "restaurant": { label: "Restaurante", description: "Restaurante íntimo iluminado por velas" },
  "nightclub": { label: "Boate", description: "Boate escura com lasers e fumaça" },
  "gym": { label: "Academia", description: "Academia moderna" },
  "classroom": { label: "Sala de Aula", description: "Sala de aula clara e iluminada" },
  "hospital": { label: "Hospital", description: "Corredor estéril de hospital" },
  "laboratory": { label: "Laboratório", description: "Laboratório de pesquisa com equipamentos brilhando" },
  "courtroom": { label: "Tribunal", description: "Tribunal forrado de madeira" },
  "warehouse": { label: "Galpão Industrial", description: "Galpão imenso com claraboias" },
  "subway-car": { label: "Vagão de Metrô", description: "Interior de vagão de metrô em movimento" },
  "taxi": { label: "Interior de Táxi", description: "Banco traseiro de um táxi à noite na cidade" },
  "cathedral": { label: "Catedral", description: "Interior de catedral gótica" },
  "art-gallery": { label: "Galeria de Arte", description: "Galeria minimalista em cubo branco" },

  // Urban
  "city-street": { label: "Rua da Cidade", description: "Rua movimentada da cidade" },
  "rooftop": { label: "Cobertura", description: "Terraço na cobertura sobre o skyline" },
  "back-alley": { label: "Beco dos Fundos", description: "Beco estreito e sombrio" },
  "neon-alley": { label: "Beco Neon", description: "Beco neon encharcado de chuva" },
  "park": { label: "Parque Urbano", description: "Parque urbano arborizado com trilhas" },
  "backyard": { label: "Quintal com Pátio", description: "Pátio de quintal com luzes de cordão" },
  "highway": { label: "Estrada Aberta", description: "Estrada ampla até o horizonte" },
  "bridge": { label: "Ponte Pênsil", description: "Longa ponte pênsil sobre a água" },
  "train-station": { label: "Estação de Trem", description: "Plataforma com trem aguardando" },
  "airport": { label: "Terminal de Aeroporto", description: "Terminal vasto com vidro curvo" },
  "parking-lot": { label: "Estacionamento", description: "Estacionamento suburbano ao anoitecer" },
  "penthouse": { label: "Cobertura de Luxo", description: "Cobertura de luxo com vista do skyline" },
  "gas-station": { label: "Posto de Gasolina", description: "Posto solitário de estrada à noite" },

  // Nature
  "forest": { label: "Clareira na Floresta", description: "Clareira musgosa iluminada pelo sol" },
  "beach": { label: "Praia", description: "Praia ampla de areia com ondas" },
  "mountain-peak": { label: "Pico de Montanha", description: "Cume rochoso alpino" },
  "desert": { label: "Dunas do Deserto", description: "Dunas do deserto sopradas pelo vento" },
  "jungle": { label: "Selva", description: "Interior denso e úmido de selva" },
  "grassland": { label: "Pradaria", description: "Pradaria aberta varrida pelo vento" },
  "snowy-tundra": { label: "Tundra Nevada", description: "Tundra esculpida pelo vento e congelada" },
  "lake-shore": { label: "Margem do Lago", description: "Margem tranquila de lago de montanha" },
  "riverbank": { label: "Beira do Rio", description: "Rio sinuoso com salgueiros" },
  "waterfall": { label: "Cachoeira", description: "Cachoeira despencando de penhascos musgosos" },
  "cave": { label: "Caverna", description: "Caverna rochosa com feixes de luz do dia" },
  "western-canyon": { label: "Cânion Western", description: "Mesa de pedra vermelha com rio sinuoso" },

  // Fantastical
  "alien-planet": { label: "Planeta Alienígena", description: "Paisagem alienígena com duas luas" },
  "spaceship-interior": { label: "Interior de Nave Espacial", description: "Corredor elegante de nave estelar" },
  "underwater": { label: "Subaquático", description: "Cena oceânica iluminada pelo sol" },
  "fantasy-castle": { label: "Castelo de Fantasia", description: "Pátio de castelo extenso" },
  "medieval-village": { label: "Vila Medieval", description: "Praça de vila com calçada de pedra" },
  "ancient-ruins": { label: "Ruínas Antigas", description: "Ruínas de pedra cobertas de trepadeiras" },
  "cyberpunk-city": { label: "Cidade Cyberpunk", description: "Skyline neon de megacidade" },
  "haunted-mansion": { label: "Mansão Mal-Assombrada", description: "Mansão gótica em decadência" },
  "dreamscape": { label: "Paisagem Onírica", description: "Ilhas flutuantes surreais" },
  "wasteland": { label: "Terreno Baldio Pós-apocalíptico", description: "Baldio enferrujado e nublado" },

  // Additional indoor settings
  "balcony": { label: "Sacada", description: "Sacada de apartamento ou hotel, vista urbana, intimista" },
  "attic": { label: "Sótão", description: "Sótão empoeirado de vigas de madeira, telhado inclinado" },
  "basement": { label: "Porão", description: "Porão de concreto, canos aparentes, iluminação industrial fraca" },
  "sauna": { label: "Sauna", description: "Sauna revestida de madeira, vapor, calor íntimo" },
  "dorm-room": { label: "Quarto de Alojamento", description: "Quarto de alojamento universitário, cama de solteiro, pôsteres e luzinhas" },
  "locker-room": { label: "Vestiário", description: "Vestiário de academia ou esporte, azulejos, bancos e espelhos" },
  "music-studio": { label: "Estúdio de Música", description: "Estúdio de gravação, microfones, espuma e mesa de controle" },
  "conservatory": { label: "Estufa", description: "Estufa com paredes de vidro, plantas tropicais e luz filtrada" },
}

export default map
