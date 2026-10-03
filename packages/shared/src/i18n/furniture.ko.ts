import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Seating
  "sofa": { label: "소파", description: "푹신한 쿠션 등받이와 좌석, 낮은 팔걸이, 뉴트럴 톤 패브릭 마감을 갖춘 3인용 소파" },
  "sectional-sofa": { label: "섹셔널 소파", description: "깊은 좌석, 부드러운 쿠션, 한쪽 끝의 카우치, 숨은 수납공간이나 리클라이닝 기능을 갖춘 L자형 섹셔널 소파" },
  "loveseat": { label: "러브시트", description: "둥글게 말린 팔걸이, 버튼 터프팅 등받이, 끝이 가늘어지는 나무 다리를 갖춘 콤팩트한 2인용 러브시트" },
  "armchair": { label: "안락의자", description: "높은 패딩 등받이, 곡선형 팔걸이, 가는 나무 다리 네 개를 갖춘 패브릭 안락의자" },
  "recliner": { label: "리클라이너", description: "당김 레버, 펼쳐지는 발받침, 두꺼운 가죽 커버, 뒤로 젖혀지는 등받이를 갖춘 패딩 리클라이너" },
  "office-chair": { label: "사무용 의자", description: "메시 등받이, 조절식 팔걸이, 가스 리프트 높이 조절, 5점 캐스터 베이스를 갖춘 인체공학적 사무용 의자" },
  "rocking-chair": { label: "흔들의자", description: "곡선형 흔들 받침, 엮은 등나무 등받이, 패딩 좌석 쿠션을 갖춘 나무 흔들의자" },
  "throne": { label: "왕좌", description: "높이 솟은 조각 등받이, 금박 테두리, 보석 장식, 푹신한 벨벳 쿠션을 갖춘 화려한 왕좌" },
  "bean-bag": { label: "빈백", description: "부드러운 패브릭 외피와 몸을 감싸는 베개 같은 형태의 큼직한 빈백 의자" },
  "stool": { label: "스툴", description: "둥근 나무 좌석, 바깥으로 벌어진 다리 네 개, 오래 써서 길든 멋을 지닌 등받이 없는 심플한 스툴" },
  "bench": { label: "벤치", description: "평평한 좌석, 트인 슬랫 등받이, 튼튼한 판자 다리를 갖춘 긴 나무 벤치" },
  "chaise-lounge": { label: "셰이즈 라운지", description: "비스듬한 헤드레스트, 길게 뻗은 패브릭 좌석, 돌려 깎은 나무 다리를 갖춘 우아한 셰이즈 라운지" },
  "dining-chair": { label: "다이닝 체어", description: "높은 슬랫 등받이, 패브릭 좌석 쿠션, 끝이 가늘어지는 나무 다리를 갖춘 격식 있는 다이닝 체어" },

  // Tables
  "dining-table": { label: "다이닝 테이블", description: "광택 나는 나무 상판, 두꺼운 트레슬 받침을 갖춘 6~8인용 대형 직사각형 다이닝 테이블" },
  "coffee-table": { label: "커피 테이블", description: "유리 또는 나무 상판, 미니멀한 다리, 잡지를 두는 하단 선반을 갖춘 낮은 직사각형 커피 테이블" },
  "side-table": { label: "사이드 테이블", description: "둥근 상판, 서랍 하나, 끝이 가늘어지는 얇은 다리를 갖춘 작은 사이드 테이블" },
  "console-table": { label: "콘솔 테이블", description: "길고 슬림한 상판, 섬세한 다리, 상판 아래 테두리를 따라 소용돌이 장식이 있는 좁은 콘솔 테이블" },
  "desk": { label: "책상", description: "평평한 작업면, 측면 서랍장, 뒷면 케이블 정리 홈을 갖춘 책상" },
  "workbench": { label: "작업대", description: "두꺼운 원목 집성 상판, 뒷면 타공판, 한쪽 모서리에 고정한 바이스를 갖춘 튼튼한 작업대" },
  "vanity-table": { label: "화장대", description: "넓은 삼면경, 양쪽의 작은 서랍, 아래에 쏙 들어가는 쿠션 벤치를 갖춘 화장대" },
  "nightstand": { label: "협탁", description: "서랍 하나, 트인 하단 선반, 램프를 올릴 수 있는 상판을 갖춘 작은 침대 옆 협탁" },
  "picnic-table": { label: "피크닉 테이블", description: "판자 상판, 붙박이 벤치 좌석, 비바람에 바랜 야외용 마감의 클래식한 나무 피크닉 테이블" },

  // Beds
  "bed-single": { label: "싱글 침대", description: "패딩 헤드보드, 깔끔한 시트, 발치에 접어 둔 담요를 갖춘 좁은 싱글 침대" },
  "bed-queen": { label: "퀸 침대", description: "높은 패브릭 헤드보드, 겹겹이 놓인 베개, 빳빳한 듀벳, 발치의 베드 러너를 갖춘 퀸 사이즈 침대" },
  "bed-king": { label: "킹 침대", description: "터프팅 헤드보드, 푹신한 베개 여러 개, 빳빳한 흰색 침구, 두꺼운 누빔 듀벳을 갖춘 웅장한 킹 사이즈 침대" },
  "bunk-bed": { label: "이층 침대", description: "매트리스 두 개를 층층이 올리고 측면 사다리, 안전 난간, 아이용 침구를 갖춘 튼튼한 나무 이층 침대" },
  "canopy-bed": { label: "캐노피 침대", description: "높은 조각 기둥, 위로 드리운 패브릭 캐노피, 모서리마다 늘어진 커튼을 갖춘 사주식 캐노피 침대" },
  "four-poster-bed": { label: "사주식 침대", description: "모서리마다 장식 없이 솟은 돌려 깎은 나무 기둥이 조각된 헤드보드 윤곽과 어우러지는 사주식 침대" },
  "daybed": { label: "데이베드", description: "낮은 프레임, 등받이와 팔걸이 역할을 하는 천을 씌운 세 면, 벽을 따라 놓인 볼스터 쿠션을 갖춘 데이베드" },
  "crib": { label: "아기 침대", description: "세로 살 난간, 작은 맞춤 매트리스, 안에 놓인 부드러운 봉제 인형이 있는 나무 아기 침대" },
  "futon": { label: "후톤", description: "접이식 금속 프레임 위에 얇은 패딩 매트리스를 얹어 소파에서 침대로 바뀌는 컨버터블 후톤" },
  "hammock": { label: "해먹", description: "두 지지대 사이에 매달려 부드럽게 처진 곡선과 양 끝의 화려한 술이 돋보이는 밧줄 해먹" },

  // Storage
  "bookshelf": { label: "책장", description: "여러 칸의 가로 선반, 나무 측판, 가지런히 늘어선 책들이 있는 높은 독립형 책장" },
  "wardrobe": { label: "옷장", description: "긴 옷을 걸 수 있는 행거 공간, 서랍, 장식 패널 문을 갖춘 대형 양문형 옷장" },
  "dresser": { label: "서랍장", description: "넓은 상판, 두 줄로 된 깊은 서랍 6개, 황동 손잡이, 끝이 가늘어지는 짧은 다리를 갖춘 나무 서랍장" },
  "cabinet": { label: "캐비닛", description: "패널 문, 높이 조절식 내부 선반, 황동 장식 철물을 갖춘 수납 캐비닛" },
  "chest": { label: "수납 체스트", description: "철 띠, 경첩 달린 돔형 뚜껑, 앞쪽의 묵직한 걸쇠를 갖춘 풍화된 나무 수납 체스트" },
  "trunk": { label: "스티머 트렁크", description: "가죽 끈, 황동 모서리, 여행 스티커, 열면 트레이가 드러나는 걸쇠 뚜껑을 갖춘 빈티지 스티머 트렁크" },
  "filing-cabinet": { label: "파일링 캐비닛", description: "서랍마다 라벨 슬롯, 매립형 손잡이, 상단 열쇠 잠금장치를 갖춘 4단 금속 파일링 캐비닛" },
  "tv-stand": { label: "TV 스탠드", description: "오픈 선반, 유리문 수납장, 케이블 구멍을 갖춘 낮은 엔터테인먼트 TV 스탠드" },
  "display-case": { label: "디스플레이 케이스", description: "내부 조명, 유리 선반, 잠금장치가 달린 프레임 문을 갖춘 높은 유리 디스플레이 케이스" },
  "hutch": { label: "그릇장", description: "접시를 세워 진열한 유리문 상부장과 서랍, 문이 달린 하부 수납장으로 이루어진 2단 그릇장" },
  "toy-chest": { label: "장난감 상자", description: "발랄한 데칼, 천천히 닫히는 경첩 뚜껑, 옆면에 잔뜩 붙은 스티커가 있는 페인트칠한 나무 장난감 상자" },

  // Lighting
  "floor-lamp": { label: "플로어 램프", description: "가는 금속 스탠드, 묵직한 받침, 줄 당김 스위치, 상단의 원통형 패브릭 갓을 갖춘 높은 플로어 램프" },
  "table-lamp": { label: "테이블 램프", description: "세라믹 받침, 주름진 패브릭 갓, 작은 줄 당김 스위치를 갖춘 클래식한 테이블 램프" },
  "desk-lamp": { label: "데스크 램프", description: "각도 조절 암, 경첩 헤드, 작은 원뿔형 금속 갓을 갖춘 관절식 데스크 램프" },
  "chandelier": { label: "샹들리에", description: "층층이 쏟아지는 크리스털, 곡선형 금색 암, 여러 개의 불꽃 모양 전구를 갖춘 웅장한 크리스털 샹들리에" },
  "pendant-light": { label: "펜던트 조명", description: "긴 코드에 매달린 미니멀한 금속 또는 유리 갓의 모던한 펜던트 조명" },
  "sconce": { label: "벽면 조명", description: "장식 백플레이트, 곡선형 암, 위쪽을 향한 패브릭 또는 유리 갓을 갖춘 벽면 조명" },
  "lantern": { label: "랜턴", description: "금속 프레임, 유리 패널, 안에 든 양초나 깜빡이는 전구, 상단의 손잡이 고리를 갖춘 클래식한 랜턴" },
  "candelabra": { label: "촛대", description: "휘어진 여러 갈래 가지마다 긴 양초를 꽂은 화려한 은촛대" },
  "neon-sign": { label: "네온 사인", description: "필기체 글자나 레트로 아이콘 모양으로 구부린 유리관이 벽에 색색의 빛을 드리우는 네온 사인" },

  // Kitchen & Dining
  "kitchen-island": { label: "키친 아일랜드", description: "두꺼운 원목 집성 상판, 하부 수납장, 바 스툴을 둘 수 있게 튀어나온 상판, 위쪽 걸이 랙을 갖춘 독립형 키친 아일랜드" },
  "bar-counter": { label: "바 카운터", description: "광택 나는 나무 상판, 황동 발걸이, 백라이트 유리 선반, 뒤편에 줄지어 진열된 술병을 갖춘 홈 바 카운터" },
  "bar-stool": { label: "바 스툴", description: "회전하는 둥근 좌석, 발받침 링, 금속 프레임, 선택 사양인 낮은 등받이를 갖춘 높은 바 스툴" },
  "pot-rack": { label: "냄비 걸이", description: "단철 프레임, 냄비와 팬을 매다는 S자 고리, 위쪽 향신료 선반을 갖춘 천장 걸이형 냄비 걸이" },
  "spice-rack": { label: "향신료 선반", description: "라벨을 붙인 작은 유리병들, 나무 선반, 정겹게 어수선한 매력의 벽걸이 향신료 선반" },
  "buffet": { label: "사이드보드", description: "서빙 접시를 올리는 평평한 상판, 식탁보용 서랍, 아래쪽 식기용 수납장을 갖춘 긴 다이닝룸 사이드보드" },

  // Outdoor
  "patio-chair": { label: "파티오 의자", description: "내후성 등나무 좌석, 알루미늄 프레임, 방수 쿠션을 갖춘 야외 파티오 의자" },
  "adirondack-chair": { label: "애디론댁 체어", description: "기울어진 슬랫 등받이, 넓고 평평한 팔걸이, 뒤로 완만하게 기울어진 좌석을 갖춘 클래식한 나무 애디론댁 체어" },
  "porch-swing": { label: "그네 벤치", description: "슬랫 좌석에 알록달록한 야외 쿠션을 줄지어 놓고 천장에 사슬로 매단 나무 그네 벤치" },
  "gazebo": { label: "가제보", description: "뾰족한 슁글 지붕, 벽 없이 트인 나무 기둥 여섯 개, 난간, 한 단 높인 나무 바닥을 갖춘 독립형 야외 가제보" },
  "bistro-set": { label: "비스트로 세트", description: "광택 있는 내후성 마감의 둥근 단철 테이블과 같은 디자인의 의자 두 개로 구성된 콤팩트한 야외 비스트로 세트" },
  "sun-lounger": { label: "선베드", description: "각도 조절 등받이, 흰색 비닐 스트랩, 같은 디자인의 사이드 테이블을 갖춘 풀사이드 선베드" },
  "fire-pit": { label: "파이어 핏", description: "거친 철 외관, 일렁이는 불꽃, 보호망 아래에서 빛나는 잉걸불이 있는 둥근 야외 파이어 핏" },

  // Decorative
  "mirror": { label: "거울", description: "화려한 금박 프레임, 조각된 소용돌이 장식, 살짝 바랜 은도금 유리를 갖춘 큰 벽거울" },
  "rug": { label: "러그", description: "섬세한 직조 모티프, 술 달린 끝단, 부드럽고 풍성한 파일을 갖춘 큰 패턴 러그" },
  "vase": { label: "꽃병", description: "둥근 몸체, 좁은 목, 유약 마감에 싱싱한 꽃다발을 꽂은 높은 세라믹 꽃병" },
  "grandfather-clock": { label: "그랜드파더 시계", description: "진자가 보이는 유리문, 황동 문자판, 로마 숫자, 차임 장치를 갖춘 높은 나무 그랜드파더 시계" },
  "wall-art": { label: "벽걸이 액자", description: "금박 또는 미니멀한 프레임에 갤러리 스타일 매트를 두르고 그림 한 점을 중심에 둔 큰 액자 작품" },
  "pillow": { label: "쿠션", description: "패턴 커버, 파이핑 처리한 가장자리, 풍성한 충전재, 보이지 않는 지퍼를 갖춘 장식용 쿠션" },
  "curtains": { label: "커튼", description: "두껍게 드리워지는 원단, 금속 봉에 매단 주름 상단, 양쪽 타이백을 갖춘 바닥까지 닿는 긴 커튼" },
  "sculpture": { label: "조각상", description: "여러 각도에서 빛을 받는 청동이나 대리석의 흐르는 유기적 형태를 받침대 위에 올린 추상 조각" },

  // Bath
  "bathtub": { label: "욕조", description: "둥글게 말린 테두리, 광택 나는 흰색 에나멜 내부, 화려한 주철 발 네 개를 갖춘 독립형 클로풋 욕조" },
  "shower": { label: "워크인 샤워", description: "프레임 없는 유리 패널, 타일 벽, 레인 샤워 헤드, 일자형 배수구를 갖춘 워크인 샤워" },
  "toilet": { label: "변기", description: "타원형 몸체, 길쭉한 시트, 크롬 물 내림 레버가 달린 물탱크를 갖춘 표준 흰색 세라믹 변기" },
  "sink-vanity": { label: "세면대 화장대", description: "스톤 상판, 언더마운트 세면볼, 위쪽의 넓은 거울, 아래쪽 패널 수납장을 갖춘 욕실 세면대 화장대" },
  "towel-rack": { label: "수건걸이", description: "여러 개의 가로 바마다 폭신하게 접힌 수건을 걸어 둔 벽걸이 온열 수건걸이" },
}

export default map
