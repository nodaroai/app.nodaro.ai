import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Disaster ──
  "earthquake-tremor": { label: "약한 지진", description: "약한 지면 흔들림, 매달린 물체가 흔들림" },
  "earthquake-major": { label: "강진", description: "땅이 갈라지고 잔해가 떨어짐" },
  "building-collapse": { label: "건물 붕괴", description: "낙하 중 무너지는 구조물" },
  "tsunami-wave": { label: "쓰나미 파도", description: "거대한 물의 벽이 밀려옴" },
  "tornado": { label: "토네이도", description: "지면에 닿는 깔때기 구름" },
  "hurricane": { label: "허리케인", description: "나무를 휘게 하는 광풍, 몰아치는 빗줄기" },
  "blizzard-whiteout": { label: "눈보라 화이트아웃", description: "시야를 지우는 폭설" },
  "sandstorm": { label: "모래폭풍", description: "장면을 삼키는 오렌지색 먼지의 벽" },
  "dust-storm-haboob": { label: "먼지폭풍(하부브)", description: "거대한 사막 먼지 전선" },
  "wildfire-distant": { label: "원거리 산불", description: "지평선의 오렌지빛과 연기" },
  "wildfire-engulfing": { label: "삼키는 산불", description: "다가오는 화염, 강렬한 열기 일렁임" },
  "volcanic-eruption": { label: "화산 폭발", description: "치솟는 용암, 화산재 기둥" },
  "lava-flow": { label: "용암류", description: "지면을 따라 서서히 흘러가는 이글거리는 용암의 강" },
  "ash-rain": { label: "화산재 비", description: "눈처럼 내리는 종말적 회색 화산재" },
  "avalanche": { label: "눈사태", description: "산비탈을 굴러내려오는 눈의 벽" },
  "hailstorm": { label: "우박 폭풍", description: "표면에서 튀는 큰 우박" },

  // ── Fire & Blasts ──
  "explosion-small": { label: "소형 폭발", description: "중심부 섬광을 동반한 소형 폭발" },
  "explosion-large": { label: "대형 폭발", description: "잔해를 동반한 차량 규모의 화염구" },
  "explosion-massive": { label: "초대형 폭발", description: "건물을 무너뜨리는 화염구와 충격파" },
  "nuclear-detonation": { label: "핵폭발", description: "버섯구름과 지평선을 비추는 섬광" },
  "fireball-airborne": { label: "공중 화염구", description: "공중에서 굴러가는 불꽃의 구체" },
  "gas-explosion": { label: "가스 폭발", description: "프로판 가스가 터지는 듯한 밝은 폭발" },
  "oil-fire": { label: "석유 화재", description: "높이 치솟는 그을음 섞인 화염과 짙은 검은 연기" },
  "blazing-inferno": { label: "맹렬한 화염지옥", description: "모든 것을 삼키는 불의 벽" },
  "flame-burst": { label: "화염 분출", description: "빠른 방향성 불꽃 분사" },
  "ember-shower": { label: "쏟아지는 불씨", description: "폭포처럼 쏟아지는 오렌지빛 불씨" },
  "smoke-pillar": { label: "연기 기둥", description: "검은 연기의 높은 수직 기둥" },
  "mushroom-cloud": { label: "버섯구름", description: "고전적인 돔과 줄기 형태의 폭발 구름" },

  // ── Electric ──
  "lightning-bolt": { label: "번개", description: "폭풍우 치는 하늘을 가로지르며 갈라지는 번개 줄기" },
  "lightning-strike-impact": { label: "낙뢰 충격", description: "빛의 폭발을 동반한 지면 낙뢰" },
  "lightning-storm": { label: "낙뢰 폭풍", description: "동시 다발적인 낙뢰" },
  "ball-lightning": { label: "구상 번개", description: "공중에 떠 있는 빛나는 전기 플라즈마 구체" },
  "plasma-arc": { label: "플라즈마 아크", description: "두 점 사이의 연속 고전압 아크" },
  "taser-sparks": { label: "테이저 스파크", description: "접촉 시 튀는 소형 전기 방전" },
  "electric-discharge": { label: "전기 방전", description: "고장난 장치에서 분출하는 아크 에너지" },
  "transformer-blowout": { label: "변압기 폭발", description: "전봇대 위의 청백색 폭발" },
  "st-elmos-fire": { label: "세인트 엘모의 불", description: "금속 끝부분의 으스스한 푸른 플라즈마 빛" },
  "static-shock-burst": { label: "정전기 스파크", description: "눈에 보이는 작은 정전기 불꽃" },

  // ── Combat ──
  "muzzle-flash": { label: "총구 화염", description: "총구에서 터지는 밝은 오렌지 섬광" },
  "gunshot-impact": { label: "탄착 충격", description: "표면을 때리는 탄환과 흩날리는 파편" },
  "bullet-trail": { label: "탄환 궤적", description: "공기를 가르는 가시적인 탄환 궤적" },
  "sword-spark": { label: "검 불꽃", description: "매크로로 담은, 금속끼리 부딪혀 쏟아지는 마찰 불꽃" },
  "blade-clash": { label: "검 격돌", description: "충격파를 일으키며 맞부딪히는 두 칼날" },
  "ricochet-spark": { label: "도탄 불꽃", description: "금속에 튕기는 탄환과 불꽃" },
  "debris-field": { label: "잔해 지대", description: "공중에 멈춰 흩어지는 파편" },
  "glass-shatter-airborne": { label: "공중 유리 파열", description: "공중에서 바깥으로 산산조각 나 흩어지는 유리 파편" },
  "shockwave-ground": { label: "지면 충격파", description: "지면을 따라 퍼져 나가는, 눈에 보이는 고리 모양 파동" },
  "sonic-boom": { label: "음속 폭음", description: "초음속에서의 압축 공기 원뿔" },
  "smoke-grenade": { label: "연막탄", description: "바깥으로 피어오르는 짙은 컬러 연기" },
  "flashbang": { label: "섬광탄", description: "시야를 가리는 백색 섬광 폭발" },
  "blood-spray": { label: "피 튀김", description: "영화적인 호를 그리며 튀는 핏방울" },
  "arrow-hit-spark": { label: "화살 명중 불꽃", description: "충돌 지점의 작은 불꽃과 함께 박히는 화살" },

  // ── Sci-Fi ──
  "laser-blast": { label: "레이저 발사", description: "밝은 결맞은 에너지 빔" },
  "energy-beam": { label: "에너지 빔", description: "넓고 맥동하는 플라즈마 에너지 빔" },
  "plasma-bolt": { label: "플라즈마 볼트", description: "증기 흔적을 남기는 빛나는 발사체" },
  "force-field-shimmer": { label: "역장의 어른거림", description: "육각 패턴의 반투명 에너지 장벽" },
  "force-field-impact": { label: "역장 충돌", description: "발사체가 보호막에 부딪힌 자리에 번지는 파문" },
  "portal-opening": { label: "포털 개방", description: "공간을 찢는 에너지 소용돌이" },
  "warp-distortion": { label: "워프 왜곡", description: "물체 주위로 휘어지는 시공간" },
  "hologram-flicker": { label: "홀로그램 깜빡임", description: "글리치가 발생하는 반투명 투영" },
  "ion-storm": { label: "이온 폭풍", description: "우주를 배경으로 지지직 튀는 대전 입자의 장" },
  "antimatter-flash": { label: "반물질 섬광", description: "현실을 찢는 순백 에너지의 폭발" },

  // ── Magic ──
  "fireball-spell": { label: "파이어볼 주문", description: "손으로 시전한 휘몰아치는 불의 구체" },
  "magic-aura": { label: "마법의 오라", description: "인물을 둘러싼 빛나는 에너지 후광" },
  "summoning-glyph": { label: "소환 문양", description: "지면에 빛나는 마법진" },
  "lightning-magic": { label: "번개 마법", description: "시전자의 손에서 호를 그리는 전기 마법" },
  "ice-shard-burst": { label: "얼음 파편 폭발", description: "바깥으로 흩날리는 결정 파편" },
  "energy-rune": { label: "에너지 룬", description: "공중에 떠 있는 빛나는 비전 상징" },
  "portal-magic": { label: "마법 포털", description: "공간에 휘몰아치는 신비한 출입구" },
  "healing-glow": { label: "치유의 광채", description: "시전자에게서 발산되는 따뜻한 황금빛" },
  "dark-vortex": { label: "암흑 소용돌이", description: "불길하게 소용돌이치는 검보라색 공허" },
  "light-explosion": { label: "빛의 폭발", description: "순백과 금빛이 어우러진 광채의 폭발" },
}

export default map
