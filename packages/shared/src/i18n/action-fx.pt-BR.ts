import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Disaster ──
  "earthquake-tremor": { label: "Tremor de terra", description: "Tremor leve, objetos pendurados balançam" },
  "earthquake-major": { label: "Terremoto forte", description: "Solo se rachando, escombros caindo" },
  "building-collapse": { label: "Desabamento de prédio", description: "Estrutura desmoronando em queda" },
  "tsunami-wave": { label: "Onda de tsunami", description: "Imensa parede de água avançando" },
  "tornado": { label: "Tornado", description: "Nuvem em funil tocando o solo" },
  "hurricane": { label: "Furacão", description: "Ventos uivantes dobrando árvores, cortinas de chuva" },
  "blizzard-whiteout": { label: "Nevasca cega", description: "Neve densa eliminando a visibilidade" },
  "sandstorm": { label: "Tempestade de areia", description: "Parede de poeira laranja engolindo a cena" },
  "dust-storm-haboob": { label: "Tempestade de poeira (haboob)", description: "Imensa frente de poeira do deserto" },
  "wildfire-distant": { label: "Incêndio florestal distante", description: "Brilho laranja e fumaça no horizonte" },
  "wildfire-engulfing": { label: "Incêndio avassalador", description: "Chamas se aproximando, intenso tremular de calor" },
  "volcanic-eruption": { label: "Erupção vulcânica", description: "Lava jorrando, coluna de cinzas" },
  "lava-flow": { label: "Fluxo de lava", description: "Rio incandescente de rocha derretida avançando devagar pelo solo" },
  "ash-rain": { label: "Chuva de cinzas", description: "Cinzas apocalípticas caindo como neve" },
  "avalanche": { label: "Avalanche", description: "Parede de neve descendo a montanha" },
  "hailstorm": { label: "Tempestade de granizo", description: "Granizos grandes ricocheteando nas superfícies" },

  // ── Fire & Blasts ──
  "explosion-small": { label: "Explosão pequena", description: "Estouro compacto com flash focal" },
  "explosion-large": { label: "Explosão grande", description: "Bola de fogo do tamanho de um veículo com escombros" },
  "explosion-massive": { label: "Explosão massiva", description: "Bola de fogo que arrasa prédios com onda de choque" },
  "nuclear-detonation": { label: "Detonação nuclear", description: "Cogumelo atômico e flash que ilumina o horizonte" },
  "fireball-airborne": { label: "Bola de fogo aérea", description: "Esfera de chamas rolando no ar" },
  "gas-explosion": { label: "Explosão de gás", description: "Estouro brilhante estilo propano" },
  "oil-fire": { label: "Incêndio de petróleo", description: "Chamas altas e oleosas com fumaça preta densa" },
  "blazing-inferno": { label: "Inferno ardente", description: "Parede de fogo consumindo tudo" },
  "flame-burst": { label: "Jato de chamas", description: "Jato direcional rápido de fogo" },
  "ember-shower": { label: "Chuva de brasas", description: "Cascata de brasas laranja brilhantes" },
  "smoke-pillar": { label: "Coluna de fumaça", description: "Alta coluna vertical de fumaça preta" },
  "mushroom-cloud": { label: "Cogumelo atômico", description: "Clássica nuvem de detonação com domo e haste" },

  // ── Electric ──
  "lightning-bolt": { label: "Raio", description: "Descarga ramificada cortando o céu tempestuoso" },
  "lightning-strike-impact": { label: "Impacto de raio", description: "Raio atingindo o solo com explosão de luz" },
  "lightning-storm": { label: "Tempestade elétrica", description: "Múltiplos raios simultâneos" },
  "ball-lightning": { label: "Raio globular", description: "Esfera brilhante de plasma elétrico flutuando no ar" },
  "plasma-arc": { label: "Arco de plasma", description: "Arco contínuo de alta voltagem entre dois pontos" },
  "taser-sparks": { label: "Faíscas de Taser", description: "Descarga elétrica compacta crepitante no contato" },
  "electric-discharge": { label: "Descarga elétrica", description: "Estouro de energia em arco de um dispositivo defeituoso" },
  "transformer-blowout": { label: "Estouro de transformador", description: "Explosão azul-branca no topo de um poste de energia" },
  "st-elmos-fire": { label: "Fogo de Santelmo", description: "Sinistro brilho azul de plasma em pontas metálicas" },
  "static-shock-burst": { label: "Choque estático", description: "Pequena faísca visível de eletricidade estática" },

  // ── Combat ──
  "muzzle-flash": { label: "Clarão do disparo", description: "Brilhante flash laranja saindo do cano da arma" },
  "gunshot-impact": { label: "Impacto de tiro", description: "Bala atingindo uma superfície e lançando fragmentos" },
  "bullet-trail": { label: "Rastro de bala", description: "Trajeto visível de bala cortando o ar" },
  "sword-spark": { label: "Faísca de espada", description: "Chuva de faíscas em macro, do atrito de metal contra metal" },
  "blade-clash": { label: "Choque de lâminas", description: "Duas lâminas se encontrando com onda de impacto" },
  "ricochet-spark": { label: "Faísca de ricochete", description: "Bala ricocheteando em metal com faíscas" },
  "debris-field": { label: "Campo de estilhaços", description: "Estilhaços congelados no ar se dispersando" },
  "glass-shatter-airborne": { label: "Vidro se estilhaçando no ar", description: "Vidro explodindo em cacos suspensos no ar" },
  "shockwave-ground": { label: "Onda de choque no solo", description: "Anel expansivo visível no nível do chão" },
  "sonic-boom": { label: "Estrondo sônico", description: "Cone de ar comprimido em velocidade supersônica" },
  "smoke-grenade": { label: "Granada de fumaça", description: "Fumaça colorida densa se expandindo para fora" },
  "flashbang": { label: "Granada de luz e som", description: "Estouro cegante de luz branca" },
  "blood-spray": { label: "Esguicho de sangue", description: "Arco cinematográfico de gotas de sangue" },
  "arrow-hit-spark": { label: "Faísca de impacto de flecha", description: "Flecha atingindo com pequenas faíscas no impacto" },

  // ── Sci-Fi ──
  "laser-blast": { label: "Disparo de laser", description: "Feixe coerente brilhante de energia" },
  "energy-beam": { label: "Feixe de energia", description: "Feixe largo e pulsante de energia plasmática" },
  "plasma-bolt": { label: "Projétil de plasma", description: "Projétil brilhante deixando rastro de vapor" },
  "force-field-shimmer": { label: "Cintilação de campo de força", description: "Barreira de energia translúcida com padrão hexagonal" },
  "force-field-impact": { label: "Impacto em campo de força", description: "Onda visível onde o projétil atinge o escudo" },
  "portal-opening": { label: "Abertura de portal", description: "Vórtice de energia rasgando o espaço" },
  "warp-distortion": { label: "Distorção de warp", description: "Espaço-tempo dobrando ao redor de um objeto" },
  "hologram-flicker": { label: "Holograma tremulante", description: "Projeção translúcida com falhas de imagem" },
  "ion-storm": { label: "Tempestade iônica", description: "Campo crepitante de partículas carregadas em fundo cósmico" },
  "antimatter-flash": { label: "Flash de antimatéria", description: "Estouro de energia branca pura rasgando a realidade" },

  // ── Magic ──
  "fireball-spell": { label: "Feitiço de bola de fogo", description: "Esfera de fogo turbilhonante lançada com a mão" },
  "magic-aura": { label: "Aura mágica", description: "Halo brilhante de energia ao redor de uma figura" },
  "summoning-glyph": { label: "Glifo de invocação", description: "Círculo mágico brilhante no solo" },
  "lightning-magic": { label: "Magia de raios", description: "Bruxaria elétrica saindo das mãos do conjurador" },
  "ice-shard-burst": { label: "Estouro de estilhaços de gelo", description: "Estilhaços cristalinos se dispersando para fora" },
  "energy-rune": { label: "Runa de energia", description: "Símbolo arcano brilhante suspenso no ar" },
  "portal-magic": { label: "Portal mágico", description: "Portal místico turbilhonante no espaço" },
  "healing-glow": { label: "Brilho de cura", description: "Luz dourada quente emanando do conjurador" },
  "dark-vortex": { label: "Vórtice sombrio", description: "Vazio sinistro turbilhonante negro e roxo" },
  "light-explosion": { label: "Explosão de luz", description: "Estouro de pura radiância branco-dourada" },
}

export default map
