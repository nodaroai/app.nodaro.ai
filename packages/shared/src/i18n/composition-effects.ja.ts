import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "none": { label: "なし", description: "構図エフェクトなし" },
  "bursting-through-frame": { label: "フレームを突き破る", description: "フレームを破る3D紙破り効果" },
  "breaking-out-of-frame": { label: "フレームから飛び出す", description: "手足がキャンバスの境界を越える" },
  "pixel-disintegration": { label: "ピクセル崩壊", description: "粒子となって崩れていく被写体" },
  "smoke-sculpture": { label: "煙の彫刻", description: "渦巻く煙でできた被写体" },
  "liquid-sculpture": { label: "液体の彫刻", description: "流れる液体でできた被写体" },
  "shattering-glass": { label: "砕け散るガラス", description: "飛び散る瞬間のまま静止したガラス片" },
  "emerging-from-background": { label: "背景から現れる", description: "テクスチャのある表面から半分浮かび上がる" },
  "fragmented-mosaic": { label: "断片化したモザイク", description: "モザイクタイルで構築された肖像" },
  "glitch-distortion": { label: "グリッチ歪み", description: "RGBシフトのデジタル破損" },
  "doubled-mirror": { label: "二重の鏡", description: "鏡面反射による複製" },
  "floating-fragments": { label: "浮かぶ断片", description: "体が部分的に漂い去る" },
  "silhouette-outline": { label: "シルエットの輪郭", description: "フラットな背景上の真っ黒なシルエット" },
  "exploding-particles": { label: "爆発する粒子", description: "粒子に飛散する輪郭" },

  // Additional composition effects
  "matte-painting": { label: "マットペインティング", description: "実写となじませて合成したマットペインティングの背景、古典的な VFX 手法" },
  "double-exposure": { label: "二重露光", description: "2つの露光を重ねて1枚の画像に融合" },
  "multiple-exposure": { label: "多重露光", description: "3回以上の露光を重ねた、万華鏡のようなレイヤー" },
  "in-camera-effects": { label: "カメラ内エフェクト", description: "ポスプロを使わない、カメラ内で生み出す実写の光学効果" },
  "prism-flares": { label: "プリズムフレア", description: "クリスタルプリズムが光を屈折させスペクトル帯に分けるフレア" },
}

export default map
