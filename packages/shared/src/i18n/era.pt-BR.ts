import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // 20th-century decades
  "1920s-flapper": { label: "Melindrosa dos anos 1920", description: "Glamour da era do jazz e dos speakeasies" },
  "1930s-art-deco": { label: "Art déco dos anos 1930", description: "Glamour deco aerodinâmico" },
  "1940s-wartime": { label: "Anos 1940 de guerra", description: "Roupa utilitária de guerra e victory rolls" },
  "1950s-diner": { label: "Lanchonete / pin-up dos anos 1950", description: "Lanchonetes cromadas e pin-ups com bouffant" },
  "1960s-mod": { label: "Mod dos anos 1960", description: "Visual gráfico mod da Swinging London" },
  "1970s-disco": { label: "Disco dos anos 1970", description: "Glitter de bola de espelhos do Studio 54" },
  "1980s-neon": { label: "Neon dos anos 1980", description: "Excesso neon de power suit e MTV" },
  "1990s-mall": { label: "Shopping dos anos 1990", description: "Anos 90 da galera do shopping, entre grunge e pop" },
  "2000s-y2k": { label: "Tabloide dos anos 2000 / Y2K", description: "Tabloide de cintura baixa sob flash de paparazzi" },

  // Pre-modern
  "medieval": { label: "Medieval", description: "Idade Média europeia em castelos de pedra" },
  "renaissance": { label: "Renascença", description: "Grandiosidade florentina de veludo e afrescos" },
  "victorian": { label: "Vitoriana", description: "Século XIX de espartilhos e rendas, à luz de gás" },
  "edwardian": { label: "Eduardiana", description: "Refinamento Belle Époque dos jardins de chá" },
  "wild-west": { label: "Velho Oeste", description: "Velho Oeste americano de cowboy e sol castigante" },
  "ancient-rome": { label: "Roma Antiga", description: "Roma imperial de colunas de mármore" },
  "ancient-egypt": { label: "Antigo Egito", description: "Egito faraônico do Nilo entre ouro e linho" },
  "feudal-japan": { label: "Japão feudal", description: "Era Edo de samurais e gueixas" },
  "roaring-prewar": { label: "Pré-guerra efervescente", description: "Limiar da art-nouveau no fim dos anos 1910" },

  // Speculative
  "near-future": { label: "Futuro próximo", description: "5 a 15 anos à frente, plausível" },
  "far-future": { label: "Futuro distante", description: "Era espacial daqui a séculos" },
  "dieselpunk": { description: "História alternativa industrial dos anos 1930-40" },
  "atompunk": { description: "Otimismo da era espacial, com o futuro visto dos anos 1950" },
  "cyberpunk-future": { label: "Futuro cyberpunk", description: "Megacidade neon de alta tecnologia e vidas à margem" },
  "post-apocalyptic": { label: "Pós-apocalíptico", description: "Sobrevivência de catadores em terra devastada" },
  "retrofuturism": { label: "Retrofuturismo", description: "Nostalgia do amanhã de ontem" },

  // Additional eras
  "atomic-age-50s": { label: "Era atômica dos anos 50", description: "Futurismo sci-fi dos anos 1950 com ansiedade da Guerra Fria" },
  "gen-z-2020s": { label: "Geração Z dos anos 2020", description: "Era atual pensada para o celular, com cara de TikTok" },
  "fin-de-siecle": { label: "Fin-de-siècle (1895-1905)", description: "Elegância europeia da Belle Époque na virada do século" },
}

export default map
