import {
  COSTUME_SHOP_CONFIG
} from "./costume.js";

export const DEFAULT_CHARACTER_STATE = Object.freeze({
  back: null,
  base: "/assets/character/base.png",
  body: null,
  expression: "/assets/character/expressions/default.png",
  face: null,
  head: null,
  front: null,
  costumeVersion: COSTUME_SHOP_CONFIG.costumeVersion
});

const CHARACTER_LAYERS = [
  "back",
  "base",
  "body",
  "expression",
  "face",
  "head",
  "front"
];

function safeCharacterPath(value) {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (!path) return null;
  if (!/^\/assets\/character\/[A-Za-z0-9_./-]+\.png$/i.test(path)) {
    return null;
  }
  return path;
}

function hasCustomCostume(source) {
  if (!source || typeof source !== "object") return false;

  if (
    source.back ||
    source.body ||
    source.face ||
    source.head ||
    source.front
  ) {
    return true;
  }

  return Boolean(
    source.expression &&
    source.expression !== DEFAULT_CHARACTER_STATE.expression
  );
}

export function normalizeCharacterState(value) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};

  const savedVersion = Number(source.costumeVersion || 0);
  const currentVersion = COSTUME_SHOP_CONFIG.costumeVersion;

  // 유료 상점으로 전환할 때 costumeVersion을 올리면 테스트 기간에
  // 장착했던 코스튬이 다른 사용자 화면에서도 즉시 기본 상태로 보인다.
  const shouldResetCostume =
    hasCustomCostume(source) &&
    savedVersion !== currentVersion;

  const effectiveSource = shouldResetCostume ? {} : source;
  const result = {};

  for (const layer of CHARACTER_LAYERS) {
    const saved = safeCharacterPath(effectiveSource[layer]);
    result[layer] = saved || DEFAULT_CHARACTER_STATE[layer] || null;
  }

  result.base = result.base || DEFAULT_CHARACTER_STATE.base;
  result.expression = result.expression || DEFAULT_CHARACTER_STATE.expression;
  result.costumeVersion = currentVersion;

  return result;
}

export async function loadUserCharacterMap(db, userIds = []) {
  const unique = new Map();
  for (const value of userIds) {
    if (!value) continue;
    const key = String(value);
    if (!unique.has(key)) unique.set(key, value);
  }

  const ids = [...unique.values()];
  if (!ids.length) return new Map();

  const users = await db.collection("users").find(
    { _id: { $in: ids } },
    { projection: { _id: 1, character: 1 } }
  ).toArray();

  return new Map(users.map(user => [
    String(user._id),
    normalizeCharacterState(user.character)
  ]));
}
