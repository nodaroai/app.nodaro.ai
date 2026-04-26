import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Swords
  "katana": { label: "카타나", description: "외날의 부드럽게 휘어진 칼날, 가오리 가죽으로 감싼 손잡이, 디스크 모양의 츠바 가드, 거울 같은 광택 마감을 가진 일본 카타나입니다" },
  "longsword": { label: "롱소드", description: "곧게 가늘어지는 양날 칼, 십자 가드, 가죽으로 감싼 그립, 둥근 폼멜을 가진 중세 양날 롱소드입니다" },
  "broadsword": { label: "브로드소드", description: "넓고 곧은 양날 칼, 바스켓 힐트 가드, 튼튼한 가죽 그립을 가진 무거운 브로드소드입니다" },
  "rapier": { label: "레이피어", description: "길고 좁은 찌르기 칼, 화려한 스웹트 힐트 바스켓 가드, 구형 폼멜을 가진 슬림한 레이피어입니다" },
  "saber": { label: "사브르", description: "외날의 휘어진 칼, 황동 너클 보우 가드, 가죽 그립을 가진 기병용 사브르입니다" },
  "scimitar": { label: "시미터", description: "넓은 외날 칼, 화려한 십자 가드, 둥근 금속 폼멜을 가진 휘어진 시미터입니다" },
  "claymore": { label: "클레이모어", description: "긴 곧은 칼, 앞쪽으로 기울어진 십자 가드, 큰 가죽 그립을 가진 거대한 양손 스코틀랜드 클레이모어입니다" },
  "cutlass": { label: "커틀러스", description: "짧고 휘어진 외날 칼, 황동 컵 모양 핸드 가드, 풍파를 겪은 목재 그립을 가진 해적 커틀러스입니다" },
  "wakizashi": { label: "와키자시", description: "부드럽게 휘어진 칼날, 작은 츠바, 가오리 가죽으로 감싼 손잡이를 가진 짧은 일본식 와키자시 컴패니언 검입니다" },
  "falchion": { label: "팔치온", description: "클리버 같은 가늘어지는 외날 칼, 단순한 십자 가드, 리벳된 가죽 그립을 가진 무거운 팔치온입니다" },

  // Daggers & Knives
  "dagger": { label: "단검", description: "좁고 뾰족한 칼날, 십자 가드, 가죽으로 감싼 그립을 가진 클래식 양날 단검입니다" },
  "bowie-knife": { label: "보위 나이프", description: "클립 포인트 칼날, 황동 가드, 적층 가죽 와셔 손잡이, 십자 가드를 가진 큰 보위 나이프입니다" },
  "kukri": { label: "쿠크리", description: "앞으로 휘어진 넓은 칼날, 목재 손잡이, 안쪽으로 각진 리커브가 특징인 네팔 쿠크리입니다" },
  "stiletto": { label: "스틸레토", description: "길고 바늘처럼 가는 삼각형 칼날, 미니멀한 십자 가드, 가늘어지는 손잡이를 가진 슬림한 스틸레토입니다" },
  "dirk": { label: "더크", description: "긴 곧은 외날 칼, 켈트 매듭 손잡이, 화려한 폼멜을 가진 스코틀랜드 더크입니다" },
  "tanto": { label: "탄토", description: "각진 끌 모양 끝, 작은 츠바, 감싼 가오리 가죽 손잡이를 가진 일본 탄토 단검입니다" },
  "switchblade": { label: "잭나이프", description: "스프링 작동식 접이식 칼날, 진주나 레진 사이드 패널, 광택 나는 릴리스 버튼을 가진 포켓 잭나이프입니다" },
  "trench-knife": { label: "트렌치 나이프", description: "슬림한 양날 칼날과 그립을 감싸는 황동 너클 더스터 핸드가드를 가진 군용 트렌치 나이프입니다" },

  // Axes
  "battle-axe": { label: "전투도끼", description: "넓고 휘어진 절단날, 베어드 프로파일, 철제 띠로 묶은 긴 목재 자루를 가진 무거운 양손 전투도끼입니다" },
  "tomahawk": { label: "토마호크", description: "작은 단일 비트 철제 헤드, 곧은 목재 자루, 그립 근처의 가죽 감기를 가진 가벼운 투척용 토마호크입니다" },
  "hatchet": { label: "손도끼", description: "짧은 목재 손잡이, 작은 단일 비트 강철 헤드, 망치질된 마감을 가진 콤팩트한 손도끼입니다" },
  "halberd": { label: "할버드", description: "도끼날, 찌르는 창 끝, 키 큰 목재 자루 위의 후방 후크를 결합한 긴 폴 할버드입니다" },
  "greataxe": { label: "그레이트 액스", description: "거대한 양면 초승달 헤드, 철제 보강 띠, 양손이 필요한 길고 무거운 자루를 가진 거대한 그레이트 액스입니다" },
  "bearded-axe": { label: "베어드 액스", description: "길어진 하단 칼날, 좁은 철제 헤드, 가죽으로 감싼 키 큰 목재 자루를 가진 바이킹 베어드 액스입니다" },

  // Polearms
  "spear": { label: "창", description: "잎 모양 철제 창두를 키 큰 곧은 목재 자루에 묶고 베이스에 작은 버트 캡이 있는 단순한 창입니다" },
  "lance": { label: "랜스", description: "긴 목재 자루, 원뿔형 강철 끝, 그립을 보호하는 플레어드 핸드 가드를 가진 마상 시합용 랜스입니다" },
  "pike": { label: "파이크", description: "작은 삼각형 창두가 사람 키의 두 배인 거대한 목재 자루 위에 장착된 매우 긴 파이크입니다" },
  "glaive": { label: "글레이브", description: "긴 휘어진 외날 칼날이 목재 자루에 장착되고 작은 십자 가드로 가늘어지는 글레이브 폴암입니다" },
  "trident": { label: "삼지창", description: "날카로운 미늘 갈래, 중앙 자루, 긴 목재 폴을 가진 세 갈래 삼지창입니다" },
  "naginata": { label: "나기나타", description: "휘어진 외날 칼날이 긴 옻칠 목재 폴에 장착되고 비단 감기가 있는 일본 나기나타입니다" },

  // Bows & Crossbows
  "longbow": { label: "롱보우", description: "주목 한 조각, 왁스칠한 린넨 활시위, 가죽으로 감싼 그립을 가진 키 큰 영국식 롱보우입니다" },
  "recurve-bow": { label: "리커브 보우", description: "궁수에서 멀어지는 휘어진 림, 가죽으로 감싼 라이저, 팽팽한 활시위를 가진 전통 리커브 보우입니다" },
  "compound-bow": { label: "컴파운드 보우", description: "알루미늄 캠, 각 끝의 풀리 휠, 카본 파이버 화살 받침, 조준 핀 어레이를 가진 모던 컴파운드 보우입니다" },
  "crossbow": { label: "크로스보우", description: "수평 목재 스톡, 강철 프로드, 팽팽한 시위, 레일 아래 트리거 메커니즘을 가진 중세 크로스보우입니다" },
  "short-bow": { label: "쇼트 보우", description: "단순한 곡선 프로파일, 왁스칠한 활시위, 가운데 가죽 그립을 가진 콤팩트한 목재 쇼트 보우입니다" },

  // Blunt & Impact
  "mace": { label: "메이스", description: "왕관 모양 무거운 헤드에 돌출된 철제 플랜지, 짧은 철제 자루를 가진 중세 플랜지드 메이스입니다" },
  "war-hammer": { label: "워 해머", description: "한쪽에 평평한 타격면과 다른 쪽에 휘어진 스파이크가 있는 무거운 철제 헤드를 가진 긴 손잡이 워 해머입니다" },
  "club": { label: "곤봉", description: "두꺼운 옹이 진 헤드, 가늘어지는 자루, 베이스 근처의 사용감 있는 가죽 그립을 가진 단순한 목재 곤봉입니다" },
  "morning-star": { label: "모닝 스타", description: "큰 철제 공이 사방으로 키 큰 스파이크가 솟아 있는 모닝 스타입니다" },
  "flail": { label: "플레일", description: "스파이크 철제 공이 짧은 사슬로 목재 자루와 연결되고 철제 끝 캡이 있는 군용 플레일입니다" },
  "nunchaku": { label: "쌍절곤", description: "두 개의 광택 나는 목재 봉이 짧은 길이의 꼰 줄이나 사슬로 연결된 무술용 쌍절곤입니다" },

  // Throwing
  "shuriken": { label: "수리검", description: "중심 허브에서 방사되는 여러 면도날 같은 뾰족한 점, 검게 처리된 강철 마감을 가진 금속 투척 별입니다" },
  "throwing-knife": { label: "투척 나이프", description: "잎 모양 양날 칼날, 미니멀한 손잡이, 광택 나는 강철 마감을 가진 균형 잡힌 투척 나이프입니다" },
  "boomerang": { label: "부메랑", description: "굽힘, 부족 패턴 페인팅, 매끄러운 공기역학적 프로파일을 가진 휘어진 목재 부메랑입니다" },
  "javelin": { label: "투창", description: "슬림한 강철 끝, 가늘어지는 목재 자루, 균형점 근처의 가죽 그립 감기를 가진 가벼운 투척 투창입니다" },
  "bolas": { label: "볼라스", description: "꼰 가죽 끈으로 묶인 세 개의 무게가 있는 돌 또는 철제 공이 중앙 매듭에서 만나는 볼라스입니다" },

  // Modern Firearms
  "pistol": { label: "권총", description: "매트 블랙 폴리머 프레임, 리브드 슬라이드, 트리거 가드, 평평한 탄창 베이스를 가진 모던 반자동 권총입니다" },
  "revolver": { label: "리볼버", description: "회전 실린더, 긴 총신, 뒤로 젖혀진 해머, 체크된 목재 그립을 가진 6연발 리볼버입니다" },
  "assault-rifle": { label: "돌격소총", description: "긴 총신, 접이식 스톡, 레일의 광학 사이트, 휘어진 분리식 탄창을 가진 군용 돌격소총입니다" },
  "shotgun": { label: "샷건", description: "넓은 보어 총신, 전술 포어엔드, 아래의 튜브 탄창, 목재 또는 합성 스톡을 가진 펌프 액션 샷건입니다" },
  "smg": { label: "기관단총", description: "짧은 총신, 측면 마운트 탄창, 접이식 와이어 스톡, 일체형 포어그립을 가진 콤팩트한 기관단총입니다" },
  "sniper-rifle": { label: "저격소총", description: "긴 총신, 고배율 스코프, 양각대, 인체공학적 폴리머 스톡을 가진 볼트 액션 저격소총입니다" },
  "machine-gun": { label: "기관총", description: "긴 핀이 있는 총신, 양각대, 운반 손잡이, 측면에서 공급되는 탄띠를 가진 무거운 벨트 급송식 기관총입니다" },

  // Historical Firearms
  "musket": { label: "머스킷", description: "활강 철제 총신, 호두나무 스톡, 황동 피팅, 총구 근처에 고정된 총검을 가진 긴 부싯돌식 머스킷입니다" },
  "flintlock-pistol": { label: "부싯돌식 권총", description: "휘어진 목재 그립, 새겨진 황동 피팅, 부싯돌 해머, 단일 긴 총신을 가진 화려한 부싯돌식 권총입니다" },
  "blunderbuss": { label: "블런더버스", description: "플레어드 총구, 견고한 목재 스톡의 황동 피팅, 해적 시대의 존재감을 가진 짧은 부싯돌식 블런더버스입니다" },
  "dueling-pistol": { label: "결투용 권총", description: "슬림한 팔각형 총신, 정교하게 새겨진 록워크, 광택 나는 호두나무 그립을 가진 우아한 결투용 권총입니다" },

  // Explosives & Siege
  "grenade": { label: "수류탄", description: "당겨진 안전핀에 의해 고정된 스푼 레버를 가진 파인애플 텍스처 철제 파편 수류탄입니다" },
  "stick-grenade": { label: "막대 수류탄", description: "긴 목재 손잡이 위에 장착된 철제 탄두와 베이스의 당김 줄 퓨즈를 가진 원통형 막대 수류탄입니다" },
  "dynamite": { label: "다이너마이트", description: "끈으로 감싸 묶은 빨간 다이너마이트 막대 다발과 타오르는 끝을 가진 긴 부글거리는 퓨즈가 연결되어 있습니다" },
  "bomb": { label: "만화 폭탄", description: "위쪽에서 연기 나는 말린 퓨즈가 나오는 둥근 검은 만화 폭탄과 광택 있는 구형 철제 셸입니다" },
  "rocket-launcher": { label: "로켓 발사기", description: "긴 튜브, 전방 그립, 후방 배기 콘, 광학 조준 사이트를 가진 어깨 발사식 로켓 발사기입니다" },
  "cannon": { label: "대포", description: "목재 휠 캐리지에 장착된 긴 활강 총신과 연기 나는 환기구를 가진 주철 머즐 로딩 대포입니다" },
  "catapult": { label: "투석기", description: "젖혀진 긴 투척 암, 카운터웨이트나 비틀림 번들, 돌이 든 바구니를 가진 목재 공성 투석기입니다" },
  "trebuchet": { label: "트레뷰셋", description: "거대한 카운터웨이트, 긴 투척 암, 꼰 슬링, 무거운 목재 프레임을 가진 키 큰 중세 트레뷰셋입니다" },

  // Sci-Fi
  "laser-pistol": { label: "레이저 권총", description: "빛나는 네온 에너지 코일, 능선 있는 금속 본체, 짧은 이미터 총신을 가진 콤팩트한 SF 레이저 권총입니다" },
  "plasma-rifle": { label: "플라즈마 라이플", description: "빛나는 푸른 에너지 셀, 환기되는 총신 슈라우드, 홀로그래픽 사이트를 가진 미래형 플라즈마 라이플입니다" },
  "lightsaber": { label: "라이트세이버", description: "금속 리브드 손잡이에서 채도 높은 에너지의 키 큰 빛나는 칼날과 흐릿한 플라즈마 후광을 발산하는 레이저 검입니다" },
  "blaster": { label: "블래스터", description: "각진 차체, 빛나는 에너지 챔버, 냉각 환기구, 위에 장착된 스코프를 가진 레트로 미래형 블래스터 권총입니다" },
  "phaser": { label: "페이저", description: "미니멀한 곡선 그립, 빛나는 이미터 끝, 강도를 제어하는 매끄러운 패널을 가진 매끈한 SF 페이저입니다" },
  "rail-gun": { label: "레일건", description: "평행한 금속 레일, 차체를 따라 거대한 커패시터, 빛나는 발사체 챔버를 가진 무거운 전자기 레일건입니다" },
  "emp-grenade": { label: "EMP 수류탄", description: "노출된 코일, 빛나는 푸른 표시등, 홀로그래픽 무장 다이얼을 가진 구형 전자기 펄스 수류탄입니다" },

  // Fantasy / Magical
  "enchanted-sword": { label: "인챈트 검", description: "빛나는 룬이 새겨진 칼날, 금 상감 십자 가드, 폼멜에 박힌 보석을 가진 인챈트 검입니다" },
  "magic-staff": { label: "마법 지팡이", description: "비틀린 목재 자루가 끝에서 빛나는 크리스털을 들고 있는 가지의 왕관으로 끝나는 키 큰 옹이 진 마법사 지팡이입니다" },
  "runed-dagger": { label: "룬 단검", description: "빛나는 룬으로 새겨진 칼날, 뼈 손잡이, 가장자리를 따라 소용돌이치는 어두운 에너지를 가진 신비한 단검입니다" },
  "wizard-wand": { label: "마법사 완드", description: "옹이 진 소용돌이, 가죽 그립, 뾰족한 끝에서 새어 나오는 작은 마법의 불꽃을 가진 슬림한 목재 완드입니다" },
  "war-horn": { label: "전쟁 호른", description: "가죽과 은색 띠로 묶인 거대한 휘어진 전쟁 호른으로, 한쪽 끝에 마우스피스와 다른 쪽에 플레어된 울리는 입구가 있습니다" },
  "sorcerer-orb": { label: "마법사의 오브", description: "비틀린 은색 발톱 스탠드에 들린 크리스털 마법사의 오브로, 유리 구체 안에 소용돌이치는 비전 안개가 떠 있습니다" },
}

export default map
