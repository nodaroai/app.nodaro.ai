import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Devices / Phones
  "smartphone": { label: "스마트폰", description: "손에 든 모던한 휴대폰" },
  "smartphone-raised": { label: "들어올린 폰", description: "사진을 찍으며 들어 올린 휴대폰" },
  "polaroid-camera": { label: "폴라로이드 카메라", description: "빈티지 인스턴트 카메라" },
  "vintage-camera": { label: "빈티지 카메라", description: "스트랩이 달린 오래된 필름 카메라" },
  "dslr-camera": { label: "DSLR 카메라", description: "모던한 DSLR / 미러리스 카메라" },
  "video-camera": { label: "비디오 카메라", description: "어깨에 메는 비디오 카메라" },
  "microphone": { label: "마이크", description: "손에 드는 보컬 마이크" },
  "megaphone": { label: "메가폰", description: "확성기 / 메가폰" },
  "smartwatch": { label: "스마트워치", description: "시계를 보려고 들어 올린 손목" },

  // Drinks
  "coffee-cup": { label: "커피잔", description: "세라믹 커피잔" },
  "takeaway-coffee": { label: "테이크아웃 커피", description: "종이 테이크아웃 커피잔" },
  "wine-glass": { label: "와인잔", description: "레드 와인이 담긴 스템 와인잔" },
  "champagne-flute": { label: "샴페인 플루트", description: "길쭉한 샴페인 플루트" },
  "martini-glass": { label: "마티니 잔", description: "클래식한 마티니 잔" },
  "cocktail-glass": { label: "칵테일 잔", description: "칵테일이 담긴 낮은 잔" },
  "beer-bottle": { label: "맥주병", description: "갈색 맥주병" },
  "water-bottle": { label: "물병", description: "재사용 가능한 물병" },

  // Smoking
  "cigarette": { label: "담배", description: "손가락 사이에 끼운 불붙은 담배" },
  "cigar": { label: "시가", description: "불붙은 굵은 시가" },
  "vape-pen": { label: "전자담배", description: "슬림한 펜형 전자담배" },
  "joint": { label: "조인트", description: "손으로 만 조인트" },

  // Reading / Writing
  "book": { label: "책", description: "펼쳐진 양장본" },
  "magazine": { label: "잡지", description: "광택 나는 접힌 잡지" },
  "newspaper": { label: "신문", description: "접힌 대형판 신문" },
  "notebook": { label: "노트", description: "펼쳐진 줄 노트" },
  "pen": { label: "펜", description: "쓸 준비가 된 펜" },
  "marker": { label: "마커", description: "쓰는 중인 굵은 마커" },
  "paintbrush": { label: "붓", description: "물감을 머금은 붓" },
  "chalk": { label: "분필", description: "흰색 분필 한 자루" },

  // Bags / Accessories
  "handbag": { label: "핸드백", description: "명품 핸드백" },
  "tote-bag": { label: "토트백", description: "부드러운 캔버스 토트백" },
  "briefcase": { label: "서류가방", description: "하드 셸 서류가방" },
  "umbrella": { label: "우산", description: "펼친 검은 우산" },
  "fan-folding": { label: "접부채", description: "손으로 그림을 그린 펼친 부채" },

  // Floral / Nature
  "bouquet": { label: "꽃다발", description: "여러 꽃을 섞은 꽃다발" },
  "single-rose": { label: "장미 한 송이", description: "줄기가 긴 장미 한 송이" },
  "sunflower": { label: "해바라기", description: "키 큰 해바라기 한 송이" },
  "leaf": { label: "잎", description: "큰 잎 한 장" },
  "fruit-apple": { label: "사과", description: "신선한 사과 한 개" },

  // Instruments / Performance
  "guitar": { label: "기타", description: "몸에 비스듬히 멘 기타" },
  "violin": { label: "바이올린", description: "턱 아래에 받친 바이올린" },
  "saxophone": { label: "색소폰", description: "입에 갖다 댄 색소폰" },
  "drumsticks": { label: "드럼스틱", description: "교차한 드럼스틱 한 쌍" },
  "sheet-music": { label: "악보", description: "접힌 악보" },

  // Companion
  "small-dog": { label: "작은 개", description: "팔에 안은 작은 개" },
  "cat": { label: "고양이", description: "팔 위에 축 늘어진 고양이" },
  "plush-toy": { label: "봉제 인형", description: "꼭 껴안은 부드러운 봉제 인형" },

  // Occupational / Weapon
  "katana": { label: "카타나", description: "외날 일본도" },
  "pointer-stick": { label: "지시봉", description: "신축식 지시봉" },
  "gavel": { label: "의사봉", description: "나무로 된 법정용 의사봉" },
  "wine-bottle": { label: "와인 병", description: "포일로 봉한 미개봉 와인병" },

  // Newly added
  "parasol": { label: "파라솔", description: "빅토리아풍 / 아시아풍 장식 파라솔" },
  "locket": { label: "로켓 펜던트", description: "열린 빈티지 로켓 펜던트" },
  "lighter": { label: "라이터", description: "엄지로 불을 켠 크롬 라이터" },
  "lantern": { label: "랜턴", description: "따뜻한 호박색 빛을 내는, 손에 드는 빈티지 랜턴" },
  "flashlight": { label: "손전등", description: "어둠을 가르는 빛줄기를 내는 모던한 손전등" },
  "compass": { label: "나침반", description: "손에 든 빈티지 항해용 나침반" },
  "bow-and-arrow": { label: "활과 화살", description: "화살을 메기고 시위를 당긴 활" },
  "shield": { label: "방패", description: "손에 든 중세 방패" },

  // --- picker-gaps 2026-09-01 ---
  "work-gloves": { label: "작업용 장갑", description: "손에 든 낡은 가죽 작업용 장갑" },
}

export default map
