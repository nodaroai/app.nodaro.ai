import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Seating
  "sofa": { label: "소파", description: "푹신한 쿠션 등받이와 좌석, 낮은 팔걸이, 중성 톤 인테리어를 갖춘 3인용 소파입니다" },
  "sectional-sofa": { label: "섹셔널 소파", description: "깊은 좌석, 부드러운 쿠션, 셰이즈 끝부분, 숨겨진 수납이나 리클라이너 메커니즘을 갖춘 L자형 섹셔널 소파입니다" },
  "loveseat": { label: "러브시트", description: "롤 암, 터프트 등받이, 가는 우드 다리를 갖춘 콤팩트한 2인용 러브시트입니다" },
  "armchair": { label: "안락의자", description: "키 큰 패딩 등받이, 곡선형 팔걸이, 네 개의 가는 나무 다리를 갖춘 인테리어 안락의자입니다" },
  "recliner": { label: "리클라이너", description: "당김 레버, 펴지는 발 받침, 두꺼운 가죽 인테리어, 기울어진 등받이를 갖춘 패딩 리클라이너입니다" },
  "office-chair": { label: "사무용 의자", description: "메시 등받이, 조절 가능한 팔걸이, 가스 리프트 높이, 5점 캐스터 베이스를 갖춘 인체공학적 사무용 의자입니다" },
  "rocking-chair": { label: "흔들의자", description: "곡선 흔들이, 등나무 등받이, 패딩 좌석 쿠션을 갖춘 나무 흔들의자입니다" },
  "throne": { label: "왕좌", description: "우뚝 솟은 조각 등받이, 도금 트림, 보석 액센트, 풍성한 벨벳 쿠션을 갖춘 화려한 왕좌입니다" },
  "bean-bag": { label: "빈백", description: "부드러운 패브릭 외피와 몸을 감싸는 베개 같은 형태의 큼직한 빈백 의자입니다" },
  "stool": { label: "스툴", description: "둥근 나무 좌석, 네 개의 펼쳐진 다리, 사용감 있는 편안한 멋을 가진 등받이 없는 단순한 스툴입니다" },
  "bench": { label: "벤치", description: "평평한 좌석, 슬랫 등받이, 튼튼한 판자 다리를 가진 긴 나무 벤치입니다" },
  "chaise-lounge": { label: "셰이즈 라운지", description: "기울어진 헤드레스트, 길게 늘어진 좌석, 우드 다리를 가진 우아한 셰이즈 라운지입니다" },
  "dining-chair": { label: "다이닝 체어", description: "높은 슬랫 등받이, 좌석 쿠션, 가는 나무 다리를 가진 격식 있는 다이닝 체어입니다" },

  // Tables
  "dining-table": { label: "다이닝 테이블", description: "광택이 흐르는 나무 상판, 두꺼운 트레슬 베이스, 6~8명용 큰 직사각형 다이닝 테이블입니다" },
  "coffee-table": { label: "커피 테이블", description: "유리 또는 나무 상판, 미니멀한 다리, 잡지를 둘 수 있는 하단 선반을 가진 낮은 직사각형 커피 테이블입니다" },
  "side-table": { label: "사이드 테이블", description: "둥근 상판, 단일 서랍, 가는 다리를 가진 작은 사이드 테이블입니다" },
  "console-table": { label: "콘솔 테이블", description: "길고 슬림한 상판, 섬세한 다리, 에이프런을 따라 장식 스크롤이 있는 좁은 콘솔 테이블입니다" },
  "desk": { label: "책상", description: "평평한 작업 표면, 측면 서랍 뱅크, 뒷면의 케이블 정리 컷아웃을 갖춘 책상입니다" },
  "workbench": { label: "작업대", description: "두꺼운 도마 상판, 뒷면 페그보드 패널, 한쪽에 클램프된 바이스를 갖춘 헤비듀티 작업대입니다" },
  "vanity-table": { label: "화장대", description: "넓은 삼각 거울, 양쪽의 작은 서랍, 아래 숨겨진 쿠션 벤치를 갖춘 드레싱 화장대입니다" },
  "nightstand": { label: "협탁", description: "단일 서랍, 열린 하단 선반, 램프를 둘 수 있는 상단 표면을 가진 작은 침대 옆 협탁입니다" },
  "picnic-table": { label: "피크닉 테이블", description: "판자 상판, 부착된 벤치 좌석, 풍화된 야외 마감의 클래식한 나무 피크닉 테이블입니다" },

  // Beds
  "bed-single": { label: "싱글 침대", description: "패딩 헤드보드, 깔끔한 시트, 발치에 접힌 담요를 갖춘 좁은 싱글 침대입니다" },
  "bed-queen": { label: "퀸 침대", description: "키 큰 인테리어 헤드보드, 겹친 베개, 깔끔한 듀벳, 발치 러너를 갖춘 퀸 사이즈 침대입니다" },
  "bed-king": { label: "킹 침대", description: "터프트 헤드보드, 다수의 풍성한 베개, 깔끔한 흰색 침구, 두꺼운 누빔 듀벳을 갖춘 웅장한 킹 사이즈 침대입니다" },
  "bunk-bed": { label: "이층 침대", description: "두 개의 매트리스가 쌓인 견고한 나무 이층 침대로, 측면 사다리, 안전 레일, 키즈용 침구를 갖췄습니다" },
  "canopy-bed": { label: "캐노피 침대", description: "키 큰 조각 기둥, 위에 드리운 패브릭 캐노피, 각 모서리의 흐르는 커튼을 갖춘 사주식 캐노피 침대입니다" },
  "four-poster-bed": { label: "사주식 침대", description: "각 모서리에 우드 컬럼이 솟은 사주식 침대로, 조각된 헤드보드 프로필과 어울립니다" },
  "daybed": { label: "데이베드", description: "낮은 프레임, 등받이와 팔걸이 역할을 하는 세 개의 인테리어 측면, 벽을 따라 놓인 볼스터 쿠션을 갖춘 데이베드입니다" },
  "crib": { label: "아기 침대", description: "수직 슬랫 측면, 작은 맞춤형 매트리스, 안에 놓인 부드러운 봉제 인형이 있는 나무 아기 침대입니다" },
  "futon": { label: "후톤", description: "접이식 금속 프레임 위 슬림한 패딩 매트리스가 소파에서 침대로 변형되는 컨버터블 후톤입니다" },
  "hammock": { label: "해먹", description: "두 지지대 사이에 매달린 밧줄 해먹으로, 부드러운 곡선과 양 끝의 화려한 술이 매력적입니다" },

  // Storage
  "bookshelf": { label: "책장", description: "여러 수평 선반, 나무 측면, 깔끔하게 쌓인 책들을 가진 키 큰 독립형 책장입니다" },
  "wardrobe": { label: "옷장", description: "전체 길이 행잉 섹션, 서랍 뱅크, 장식 패널 도어를 갖춘 큰 양쪽 도어 옷장입니다" },
  "dresser": { label: "서랍장", description: "넓은 상판, 두 줄로 된 6개의 깊은 서랍, 황동 손잡이, 짧은 가는 다리를 가진 나무 서랍장입니다" },
  "cabinet": { label: "캐비닛", description: "패널 도어, 내부 조절 선반, 황동 하드웨어를 갖춘 수납 캐비닛입니다" },
  "chest": { label: "수납 체스트", description: "철 띠, 경첩이 달린 돔형 뚜껑, 정면의 무거운 걸쇠를 갖춘 풍화된 나무 수납 체스트입니다" },
  "trunk": { label: "스티머 트렁크", description: "가죽 끈, 황동 모서리, 여행 스티커, 트레이 인서트가 드러나는 걸쇠 뚜껑을 갖춘 빈티지 스티머 트렁크입니다" },
  "filing-cabinet": { label: "파일링 캐비닛", description: "각 서랍의 라벨 슬롯, 들어간 손잡이, 상단의 키 잠금장치를 갖춘 4단 금속 파일링 캐비닛입니다" },
  "tv-stand": { label: "TV 스탠드", description: "오픈 선반, 유리문 캐비닛, 케이블 통과구를 갖춘 낮은 엔터테인먼트 TV 스탠드입니다" },
  "display-case": { label: "디스플레이 케이스", description: "내부 조명, 유리 선반, 잠금 가능한 프레임 도어를 갖춘 키 큰 유리 디스플레이 케이스입니다" },
  "hutch": { label: "차이나 허치", description: "접시를 모서리로 보여주는 유리문 상부 캐비닛과 서랍과 도어가 있는 뷔페 베이스로 구성된 2부 차이나 허치입니다" },
  "toy-chest": { label: "장난감 상자", description: "쾌활한 데칼, 부드럽게 닫히는 경첩 뚜껑, 측면에 쌓인 스티커가 있는 페인트칠된 나무 장난감 상자입니다" },

  // Lighting
  "floor-lamp": { label: "플로어 램프", description: "가는 금속 스탠드, 무게가 실린 베이스, 풀 체인 스위치, 상단 드럼 패브릭 갓을 가진 키 큰 플로어 램프입니다" },
  "table-lamp": { label: "테이블 램프", description: "세라믹 베이스, 주름 패브릭 갓, 작은 풀 체인 스위치를 갖춘 클래식한 테이블 램프입니다" },
  "desk-lamp": { label: "데스크 램프", description: "조절 가능한 암, 경첩 헤드, 작은 원뿔형 금속 갓을 가진 관절식 데스크 램프입니다" },
  "chandelier": { label: "샹들리에", description: "층층이 쏟아지는 크리스털, 곡선의 황금 암, 여러 화염 모양 전구를 가진 웅장한 크리스털 샹들리에입니다" },
  "pendant-light": { label: "펜던트 조명", description: "긴 코드에 매달린 미니멀한 금속 또는 유리 갓의 모던한 펜던트 조명입니다" },
  "sconce": { label: "벽면 조명", description: "장식 백플레이트, 곡선 암, 위쪽을 향한 패브릭 또는 유리 갓을 가진 벽면 조명입니다" },
  "lantern": { label: "랜턴", description: "금속 프레임, 유리 패널, 안의 양초나 깜빡이는 전구, 상단의 운반 고리를 가진 클래식한 랜턴입니다" },
  "candelabra": { label: "촛대", description: "각각 키 큰 양초를 든 여러 곡선 분기 암을 가진 화려한 은제 촛대입니다" },
  "neon-sign": { label: "네온 사인", description: "필기체 글자나 레트로 아이콘으로 휘어진 유리 튜브가 벽에 색이 있는 빛을 비추는 빛나는 네온 사인입니다" },

  // Kitchen & Dining
  "kitchen-island": { label: "키친 아일랜드", description: "두꺼운 도마 상판, 아래 캐비닛 수납, 바 스툴 오버행, 위쪽 랙을 갖춘 독립형 키친 아일랜드입니다" },
  "bar-counter": { label: "바 카운터", description: "광택 나무 상판, 황동 발 레일, 백라이트 유리 선반, 뒤에 진열된 병들이 늘어선 홈 바 카운터입니다" },
  "bar-stool": { label: "바 스툴", description: "회전하는 둥근 좌석, 발판 링, 금속 프레임, 선택적 낮은 등받이를 가진 키 큰 바 스툴입니다" },
  "pot-rack": { label: "냄비 걸이", description: "단철 프레임, 냄비와 팬을 매다는 S자 후크, 위쪽 향신료 선반을 갖춘 천장 매달림 냄비 걸이입니다" },
  "spice-rack": { label: "향신료 선반", description: "라벨이 붙은 작은 유리병들, 나무 선반, 쾌활하게 어수선한 매력의 벽면 향신료 선반입니다" },
  "buffet": { label: "뷔페", description: "서빙 플래터를 위한 평평한 상판, 식탁보용 서랍, 식기용 캐비닛 도어를 갖춘 긴 다이닝 룸 뷔페입니다" },

  // Outdoor
  "patio-chair": { label: "파티오 의자", description: "내후성 등나무 좌석, 알루미늄 프레임, 방수 쿠션을 갖춘 야외 파티오 의자입니다" },
  "adirondack-chair": { label: "애디론댁 체어", description: "기울어진 슬랫 등받이, 넓고 평평한 팔걸이, 부드럽게 뒤로 떨어지는 좌석을 가진 클래식 나무 애디론댁 체어입니다" },
  "porch-swing": { label: "포치 스윙", description: "천장에서 사슬로 매달린 나무 포치 스윙으로, 슬랫 좌석과 다채로운 야외 쿠션이 줄지어 있습니다" },
  "gazebo": { label: "가제보", description: "뾰족한 슁글 지붕, 여섯 개의 열린 우드 컬럼, 난간, 높여진 나무 바닥을 가진 독립형 야외 가제보입니다" },
  "bistro-set": { label: "비스트로 세트", description: "둥근 단철 테이블과 두 개의 어울리는 의자가 광택 내후성 마감으로 된 콤팩트한 야외 비스트로 세트입니다" },
  "sun-lounger": { label: "선 라운저", description: "조절 가능한 리클라이닝 등받이, 흰색 비닐 스트랩, 어울리는 사이드 테이블을 갖춘 풀사이드 선 라운저입니다" },
  "fire-pit": { label: "파이어 핏", description: "거친 철 외관, 깜빡이는 불꽃, 보호 메시 스크린 아래 빛나는 잉걸불을 가진 둥근 야외 파이어 핏 보울입니다" },

  // Decorative
  "mirror": { label: "거울", description: "도금 프레임, 조각된 스크롤, 약간 낡은 은 도금이 있는 큰 벽 거울입니다" },
  "rug": { label: "러그", description: "복잡한 직조 모티프, 술 달린 끝, 부드러운 풍성한 파일을 가진 큰 패턴 면적 러그입니다" },
  "vase": { label: "꽃병", description: "둥근 몸체, 좁은 목, 유약 마감, 안에 신선한 꽃다발이 있는 키 큰 세라믹 꽃병입니다" },
  "grandfather-clock": { label: "그랜드파더 시계", description: "유리 진자 도어, 황동 시계 면, 로마 숫자, 차임 메커니즘을 갖춘 키 큰 나무 그랜드파더 시계입니다" },
  "wall-art": { label: "프레임 벽 예술품", description: "도금 또는 미니멀한 프레임에 갤러리 스타일 매트 보더와 단일 초점 그림이 있는 큰 액자 예술품입니다" },
  "pillow": { label: "쿠션", description: "패턴 커버, 파이프 가장자리, 풍성한 충전재, 보이지 않는 지퍼 잠금을 갖춘 장식용 쿠션입니다" },
  "curtains": { label: "커튼", description: "두꺼운 드레이프 패브릭, 금속 봉에 매달린 주름진 상단, 양쪽의 타이백을 가진 풀 길이 커튼입니다" },
  "sculpture": { label: "조각상", description: "여러 각도에서 빛을 받는 청동이나 대리석의 흐르는 유기적 형태를 받침대 위에 둔 추상 조각입니다" },

  // Bath
  "bathtub": { label: "욕조", description: "롤 림, 광택 흰색 에나멜 내부, 네 개의 화려한 주철 발을 가진 독립형 클로풋 욕조입니다" },
  "shower": { label: "워크인 샤워", description: "프레임 없는 유리 패널, 타일 벽, 레인폴 샤워 헤드, 선형 바닥 배수구를 갖춘 워크인 샤워입니다" },
  "toilet": { label: "변기", description: "타원형 보울, 길쭉한 시트, 크롬 플러시 핸들이 있는 탱크의 표준 흰색 세라믹 변기입니다" },
  "sink-vanity": { label: "세면대 화장대", description: "스톤 카운터탑, 언더마운트 베이슨, 위쪽의 넓은 거울, 아래 패널 캐비닛 도어를 가진 욕실 세면대 화장대입니다" },
  "towel-rack": { label: "수건걸이", description: "여러 수평 바와 각 바에 걸린 풍성한 접힌 수건이 있는 벽면 가열식 수건걸이입니다" },
}

export default map
