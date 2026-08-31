export const DEFAULT_CHARACTER_STATE = Object.freeze({
  back: null,
  base: "/assets/character/base.png",
  body: null,
  expression: "/assets/character/expressions/default.png",
  face: null,
  head: null,
  front: null
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
  // 캐릭터 이미지는 프로젝트 내부의 캐릭터 에셋만 허용한다.
  if (!/^\/assets\/character\/[A-Za-z0-9_./-]+\.png$/i.test(path)) {
    return null;
  }
  return path;
}

export function normalizeCharacterState(value) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};

  const result = {};
  for (const layer of CHARACTER_LAYERS) {
    const saved = safeCharacterPath(source[layer]);
    result[layer] = saved || DEFAULT_CHARACTER_STATE[layer] || null;
  }

  // 기본 몸과 표정은 항상 존재하게 해서 기존/신규 모든 계정에 캐릭터가 보인다.
  result.base = result.base || DEFAULT_CHARACTER_STATE.base;
  result.expression = result.expression || DEFAULT_CHARACTER_STATE.expression;
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
