import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Swords
  "katana": { description: "Katana japonesa com lâmina de fio único levemente curvada, cabo enrolado em pele de raia, guarda tsuba em forma de disco e acabamento polido tipo espelho" },
  "longsword": { label: "Espada Longa", description: "Espada longa medieval de dois gumes, com lâmina reta e afilada, cruzeta, empunhadura envolta em couro e pomo redondo" },
  "broadsword": { label: "Espada Larga", description: "Espada larga e pesada com lâmina reta de dois gumes, guarda em cesto e empunhadura robusta envolta em couro" },
  "rapier": { label: "Florete", description: "Florete esguio com lâmina longa, estreita e perfurante, guarda ornamentada em cesto curvado e pomo esférico" },
  "saber": { label: "Sabre", description: "Sabre de cavalaria com lâmina curvada de fio único, guarda de latão em arco protegendo os dedos e empunhadura em couro estriado" },
  "scimitar": { label: "Cimitarra", description: "Cimitarra curvada com lâmina larga de fio único, cruzeta ornamentada e pomo metálico arredondado" },
  "claymore": { description: "Claymore escocesa massiva de duas mãos, com lâmina longa e reta, cruzeta inclinada para frente e empunhadura grande envolta em couro" },
  "cutlass": { label: "Sabre de Abordagem", description: "Sabre de abordagem pirata com lâmina curta e curvada de fio único, guarda em forma de cuia em latão e empunhadura de madeira envelhecida" },
  "wakizashi": { description: "Lâmina curta japonesa wakizashi, companheira da katana, com fio levemente curvado, pequena tsuba e cabo envolto em pele de raia" },
  "falchion": { label: "Falchion", description: "Falchion pesado de fio único, com lâmina afilada tipo cutelo, cruzeta simples e empunhadura de couro rebitada" },

  // Daggers & Knives
  "dagger": { label: "Adaga", description: "Adaga clássica de dois gumes, com lâmina estreita e pontiaguda, cruzeta e empunhadura envolta em couro" },
  "bowie-knife": { description: "Grande faca Bowie com lâmina de ponta clip-point, guarda de latão, cabo de couro empilhado e cruzeta" },
  "kukri": { description: "Kukri nepalesa com lâmina larga curvada para frente, cabo de madeira e recurva interna característica" },
  "stiletto": { description: "Stiletto esguio com lâmina triangular longa e fina como agulha, cruzeta mínima e cabo afilado" },
  "dirk": { description: "Dirk escocês com lâmina longa e reta de fio único, empunhadura entrelaçada com nós celtas e pomo ornamentado" },
  "tanto": { description: "Adaga tanto japonesa com ponta angular tipo cinzel, pequena tsuba e cabo envolto em pele de raia" },
  "switchblade": { label: "Canivete Automático", description: "Canivete automático de bolso com lâmina dobrável acionada por mola, painéis laterais em pérola ou resina e botão de liberação polido" },
  "trench-knife": { label: "Faca de Trincheira", description: "Faca militar de trincheira com lâmina esguia de dois gumes e guarda soco-inglês de latão envolvendo a empunhadura" },

  // Axes
  "battle-axe": { label: "Machado de Guerra", description: "Pesado machado de guerra de duas mãos, com fio largo curvado, perfil barbado e cabo longo de madeira reforçado por bandas de ferro" },
  "tomahawk": { description: "Tomahawk leve de arremesso, com pequena cabeça de ferro de gume único, cabo reto de madeira e enrolamento de couro próximo à empunhadura" },
  "hatchet": { label: "Machadinha", description: "Machadinha compacta com cabo curto de madeira, pequena cabeça de aço de gume único e acabamento martelado" },
  "halberd": { label: "Alabarda", description: "Alabarda longa combinando lâmina de machado, ponta de lança perfurante e gancho traseiro sobre um cabo alto de madeira" },
  "greataxe": { label: "Grande Machado", description: "Grande machado massivo com cabeça enorme em forma de crescente duplo, bandas de reforço em ferro e cabo longo e pesado que exige duas mãos" },
  "bearded-axe": { label: "Machado Barbado", description: "Machado barbado viking com fio inferior alongado, cabeça estreita de ferro e cabo alto de madeira envolto em couro" },

  // Polearms
  "spear": { label: "Lança", description: "Lança simples com ponta de ferro em forma de folha amarrada a um cabo alto e reto de madeira, com pequena ponteira na base" },
  "lance": { label: "Lança de Justa", description: "Lança de justa com cabo longo de madeira, ponta cônica de aço e guarda flamejada protegendo a empunhadura" },
  "pike": { label: "Pique", description: "Pique muito longo com pequena ponta triangular montada no topo de um mastro de madeira do dobro da altura de um homem" },
  "glaive": { description: "Glaive — alabarda com lâmina longa curvada de fio único montada em cabo de madeira, terminando em pequena cruzeta" },
  "trident": { label: "Tridente", description: "Tridente de três pontas com farpas afiadas, haste central e longo cabo de madeira" },
  "naginata": { description: "Naginata japonesa com lâmina curvada de fio único montada em longo cabo de madeira lacada, com enrolamentos de seda" },

  // Bows & Crossbows
  "longbow": { label: "Arco Longo", description: "Alto arco longo inglês feito de uma peça única de teixo, corda de linho encerada e empunhadura envolta em couro" },
  "recurve-bow": { label: "Arco Recurvo", description: "Arco recurvo tradicional com braços que se afastam do arqueiro, riser envolto em couro e corda esticada" },
  "compound-bow": { label: "Arco Composto", description: "Arco composto moderno com cames de alumínio, roldanas em cada ponta, descanso de flecha em fibra de carbono e conjunto de pinos de mira" },
  "crossbow": { label: "Besta", description: "Besta medieval com coronha horizontal de madeira, arco de aço, corda esticada e mecanismo de gatilho sob o trilho" },
  "short-bow": { label: "Arco Curto", description: "Arco curto compacto de madeira com perfil curvado simples, corda encerada e empunhadura de couro no meio" },

  // Blunt & Impact
  "mace": { label: "Maça", description: "Maça flangeada medieval com cabeça pesada coroada por flanges de ferro salientes sobre um cabo curto de ferro" },
  "war-hammer": { label: "Martelo de Guerra", description: "Martelo de guerra de cabo longo, com cabeça pesada de ferro tendo face de impacto plana de um lado e ponta curvada do outro" },
  "club": { label: "Porrete", description: "Porrete simples de madeira com cabeça grossa e nodosa, cabo afilado e empunhadura de couro desgastada perto da base" },
  "morning-star": { description: "Morning star com cabo de madeira encimado por uma grande bola de ferro eriçada de espigões altos em todas as direções" },
  "flail": { label: "Mangual", description: "Mangual militar com bola de ferro com espigões conectada por curta corrente a um cabo de madeira com ponteira de ferro" },
  "nunchaku": { description: "Nunchaku de artes marciais com dois bastões de madeira polida unidos por uma curta corda trançada ou corrente" },

  // Throwing
  "shuriken": { description: "Estrela de arremesso shuriken com várias pontas afiadas como navalhas irradiando de um eixo central, com acabamento de aço escurecido" },
  "throwing-knife": { label: "Faca de Arremesso", description: "Faca de arremesso balanceada com lâmina em forma de folha de dois gumes, cabo mínimo e acabamento polido em aço" },
  "boomerang": { description: "Bumerangue curvo de madeira com curva em cotovelo, padrões tribais pintados e perfil aerodinâmico suave" },
  "javelin": { label: "Dardo", description: "Dardo leve de arremesso com ponta esguia de aço, cabo de madeira afilado e enrolamento de couro perto do ponto de equilíbrio" },
  "bolas": { description: "Bolas: três pesos de pedra ou ferro amarrados por cordas trançadas de couro que se encontram em um nó central" },

  // Modern Firearms
  "pistol": { label: "Pistola", description: "Pistola semiautomática moderna com armação preta fosca em polímero, ferrolho ranhurado, guarda-mato e base de carregador rente" },
  "revolver": { label: "Revólver", description: "Revólver six-shooter com cilindro giratório, cano longo, cão engatilhado e empunhadura quadriculada de madeira" },
  "assault-rifle": { label: "Fuzil de Assalto", description: "Fuzil de assalto militar com cano longo, coronha retrátil, mira óptica no trilho e carregador curvado destacável" },
  "shotgun": { label: "Espingarda", description: "Espingarda pump-action com cano de calibre largo, telha tática, carregador tubular embaixo e coronha de madeira ou sintética" },
  "smg": { label: "Submetralhadora", description: "Submetralhadora compacta com cano curto, carregador montado lateralmente, coronha de arame dobrável e empunhadura dianteira integrada" },
  "sniper-rifle": { label: "Rifle Sniper", description: "Rifle sniper de ferrolho com cano longo, luneta de alta magnificação, bipé e coronha ergonômica em polímero" },
  "machine-gun": { label: "Metralhadora", description: "Pesada metralhadora alimentada por cinta com cano longo aletado, bipé, alça de transporte e fita de munição alimentando pela lateral" },

  // Historical Firearms
  "musket": { label: "Mosquete", description: "Mosquete longo de pederneira com cano de ferro de alma lisa, coronha de nogueira, guarnições de latão e baioneta fixada perto da boca" },
  "flintlock-pistol": { label: "Pistola de Pederneira", description: "Pistola de pederneira ornamentada com empunhadura curvada de madeira, guarnições de latão gravadas, cão de pederneira e cano único e longo" },
  "blunderbuss": { label: "Bacamarte", description: "Bacamarte curto de pederneira com boca alargada, guarnições de latão sobre coronha robusta de madeira e presença da era pirata" },
  "dueling-pistol": { label: "Pistola de Duelo", description: "Elegante pistola de duelo com cano octogonal esguio, mecanismo finamente gravado e empunhadura polida de nogueira" },

  // Explosives & Siege
  "grenade": { label: "Granada", description: "Granada de fragmentação de ferro com textura de abacaxi, alavanca de spoon presa por pino de segurança puxado" },
  "stick-grenade": { label: "Granada de Cabo", description: "Granada de cabo cilíndrica com ogiva de ferro montada no topo de um longo cabo de madeira e estopim de cordão de tração na base" },
  "dynamite": { label: "Dinamite", description: "Bastões agrupados de dinamite vermelha amarrados com barbante e ligados a um longo estopim crepitante com ponta acesa" },
  "bomb": { label: "Bomba de Desenho", description: "Bomba preta redonda de desenho animado com estopim enrolado e fumegante saindo do topo e casca esférica de ferro brilhante" },
  "rocket-launcher": { label: "Lança-Foguetes", description: "Lança-foguetes de ombro com tubo longo, empunhadura dianteira, cone de exaustão traseiro e mira óptica" },
  "cannon": { label: "Canhão", description: "Canhão de ferro fundido carregado pela boca, montado em carreta de madeira com rodas, cano longo de alma lisa e respiradouro fumegante" },
  "catapult": { label: "Catapulta", description: "Catapulta de cerco de madeira com longo braço de arremesso engatilhado, contrapeso ou feixe de torção e cesto carregado com pedra" },
  "trebuchet": { label: "Trabuco", description: "Alto trabuco medieval com contrapeso massivo, longo braço de arremesso, funda trançada e armação pesada de madeira" },

  // Sci-Fi
  "laser-pistol": { label: "Pistola de Laser", description: "Compacta pistola laser sci-fi com bobinas de energia neon brilhante, corpo metálico estriado e curto cano emissor" },
  "plasma-rifle": { label: "Rifle de Plasma", description: "Futurístico rifle de plasma com células de energia azul brilhante, capas ventiladas no cano e mira holográfica" },
  "lightsaber": { label: "Sabre de Luz", description: "Espada laser com cabo metálico estriado emitindo uma lâmina alta e brilhante de energia saturada com halo plasmático nebuloso" },
  "blaster": { description: "Blaster pistola retrofuturista com corpo robusto, câmara de energia brilhante, aletas de resfriamento e mira montada no topo" },
  "phaser": { description: "Elegante phaser sci-fi com empunhadura curvada minimalista, ponta emissora brilhante e painel liso para controle de intensidade" },
  "rail-gun": { label: "Canhão Eletromagnético", description: "Pesado canhão eletromagnético com trilhos metálicos paralelos, capacitores massivos ao longo do corpo e câmara de projétil brilhante" },
  "emp-grenade": { label: "Granada EMP", description: "Granada esférica de pulso eletromagnético com bobinas expostas, luzes indicadoras azuis brilhantes e mostrador holográfico de armamento" },

  // Fantasy / Magical
  "enchanted-sword": { label: "Espada Encantada", description: "Espada encantada com lâmina gravada por runas brilhantes, cruzeta com incrustações de ouro e gema embutida no pomo" },
  "magic-staff": { label: "Cajado Mágico", description: "Alto cajado de mago retorcido, com haste de madeira torcida terminando em coroa de galhos segurando um cristal brilhante" },
  "runed-dagger": { label: "Adaga Rúnica", description: "Adaga mística com lâmina inscrita em runas brilhantes, cabo de osso e energia sombria deslizando pelo fio" },
  "wizard-wand": { label: "Varinha de Mago", description: "Varinha esguia de madeira com espirais entalhadas, empunhadura de couro e pequenas faíscas de magia escapando da ponta" },
  "war-horn": { label: "Berrante de Guerra", description: "Massivo berrante de guerra curvado, encadernado em couro e bandas de prata, com bocal em uma extremidade e abertura flamejante na outra" },
  "sorcerer-orb": { label: "Orbe de Feiticeiro", description: "Orbe de cristal de feiticeiro sustentado por um suporte torcido de prata em forma de garra, com névoa arcana rodopiando suspensa dentro da esfera de vidro" },
  "zweihander": { label: "Zweihänder", description: "Espada longa renascentista alemã empunhada com as duas mãos" },
  "slingshot": { label: "Estilingue", description: "Armação de madeira em formato de Y com elástico" },
  "blowgun": { label: "Zarabatana", description: "Tubo longo que dispara dardos com o sopro" },
  "service-pistol": { label: "Pistola de Serviço", description: "Pistola lateral semiautomática moderna" },
  "hunting-rifle": { label: "Rifle de Caça", description: "Rifle de ferrolho com coronha de madeira e luneta" },
  "plasma-sword": { label: "Espada de Plasma / Sabre de Luz", description: "Lâmina de energia sci-fi emitindo brilho intenso" },
  "gravity-gun": { label: "Arma de Gravidade", description: "Arma sci-fi de longo alcance que manipula a física" },
}

export default map
