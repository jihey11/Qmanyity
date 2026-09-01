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
    description: "동그란 얇은테 안경",
    category: "얼굴",
    layer: "face",
    asset: "/assets/character/face/round_glasses.png",
    price: null,
    active: true
  }),

  Object.freeze({
    id: "straw_hat",
    name: "밀짚모자",
    description: "리본 달린 밀짚모자",
    category: "머리",
    layer: "head",
    asset: "/assets/character/head/straw_hat.png",
    price: null,
    active: true
  }),

  Object.freeze({
    id: "ribbon",
    name: "리본",
    description: "빨간 리본",
    category: "머리",
    layer: "head",
    asset: "/assets/character/head/ribbon.png",
    price: null,
    active: true
  }),

  Object.freeze({
    id: "alien_glasses",
    name: "외계인 안경",
    description: "깨랑까랑",
    category: "얼굴",
    layer: "face",
    asset: "/assets/character/face/alien_glasses.png",
    price: null,
    active: true
  }),

  Object.freeze({
    id: "Tanghulu",
    name: "탕후루",
    description: "탕탕후루후루탕탕탕후루루루루",
    category: "도구",
    layer: "front",
    asset: "/assets/character/front/Tanghulu.png",
    price: null,
    active: true
  }),

  Object.freeze({
    id: "character_mini",
    name: "작은 찹쌀떡",
    description: "캐릭터 보다 작은친구이다",
    category: "머리",
    layer: "head",
    asset: "/assets/character/head/character_mini.png",
    price: null,
    active: true
  }),

  Object.freeze({
    id: "White_flower",
    name: "하얀 꽃",
    description: "핑크빛이 도는 하얀 꽃",
    category: "머리",
    layer: "head",
    asset: "/assets/character/head/White_flower.png",
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
