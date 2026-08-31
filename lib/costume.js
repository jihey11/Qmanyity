// =========================================================
// Qmanyity 코스튬 상점 설정
// =========================================================
// 현재는 TEST_FREE 모드다.
// 나중에 점수 구매를 시작할 때는 mode를 PAID로 바꾸고,
// costumeVersion을 2 이상으로 올리면 테스트 기간 장착 코스튬이
// 자동으로 기본 상태로 초기화된다.
export const COSTUME_SHOP_CONFIG = Object.freeze({
  mode: "TEST_FREE",
  costumeVersion: 1,
  currencyName: "점수"
});

export const COSTUME_EQUIP_LAYERS = Object.freeze([
  "back",
  "body",
  "expression",
  "face",
  "head",
  "front"
]);

// price는 유료 전환 시 숫자로 지정한다.
// 현재 TEST_FREE에서는 가격과 보유 여부에 관계없이 바로 장착 가능하다.
export const COSTUME_ITEMS = Object.freeze([
  Object.freeze({
    id: "round_glasses",
    name: "동그란 얇은테 안경",
    description: "캐릭터 얼굴에 어울리는 남색 픽셀 원형 안경",
    category: "얼굴",
    layer: "face",
    asset: "/assets/character/face/round_glasses.png",
    price: null,
    active: true
  })
]);

export function getActiveCostumeItems() {
  return COSTUME_ITEMS.filter(item => item.active);
}

export function getCostumeItemById(itemId) {
  const id = String(itemId || "").trim();
  return COSTUME_ITEMS.find(item => item.id === id && item.active) || null;
}

export function isEquipLayer(layer) {
  return COSTUME_EQUIP_LAYERS.includes(String(layer || ""));
}
