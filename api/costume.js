import {
  getDatabase
} from "../lib/mongodb.js";

import {
  getSessionFromRequest
} from "../lib/auth.js";

import {
  guardApiRequest
} from "../lib/api.js";

import {
  DEFAULT_CHARACTER_STATE,
  normalizeCharacterState
} from "../lib/character.js";

import {
  COSTUME_SHOP_CONFIG,
  getActiveCostumeItems,
  getCostumeItemById,
  isEquipLayer
} from "../lib/costume.js";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

async function getAuthenticatedUser(request) {
  const session = await getSessionFromRequest(request);
  if (!session) return { session: null, user: null, db: null };

  const db = await getDatabase();
  const user = await db.collection("users").findOne({
    _id: session.userId,
    status: "ACTIVE"
  });

  return { session, user, db };
}

function sessionError() {
  return jsonResponse({
    success: false,
    sessionExpired: true,
    message: "로그인이 필요합니다."
  }, 401);
}

async function normalizeUserCostumeState(db, user) {
  const normalized = normalizeCharacterState(user.character);
  const savedVersion = Number(user.character?.costumeVersion || 0);

  if (savedVersion !== COSTUME_SHOP_CONFIG.costumeVersion) {
    await db.collection("users").updateOne(
      { _id: user._id },
      {
        $set: {
          character: normalized,
          costumeInventory: [],
          updatedAt: new Date()
        }
      }
    );

    user.character = normalized;
    user.costumeInventory = [];
  } else {
    user.character = normalized;
  }

  return user;
}

function serializeShop(user) {
  const items = getActiveCostumeItems();
  const inventory = Array.isArray(user.costumeInventory)
    ? user.costumeInventory.map(String)
    : [];

  const testMode = COSTUME_SHOP_CONFIG.mode === "TEST_FREE";

  return {
    mode: COSTUME_SHOP_CONFIG.mode,
    testMode,
    costumeVersion: COSTUME_SHOP_CONFIG.costumeVersion,
    currencyName: COSTUME_SHOP_CONFIG.currencyName,
    point: Number(user.point || 0),
    character: normalizeCharacterState(user.character),
    ownedCostumes: inventory,
    items: items.map(item => ({
      id: item.id,
      name: item.name,
      description: item.description,
      category: item.category,
      layer: item.layer,
      asset: item.asset,
      price: item.price,
      owned: testMode || inventory.includes(item.id),
      freeTest: testMode
    }))
  };
}

async function getShop(request) {
  try {
    const { user, db } = await getAuthenticatedUser(request);
    if (!user) return sessionError();

    await normalizeUserCostumeState(db, user);

    return jsonResponse({
      success: true,
      shop: serializeShop(user)
    });
  } catch (error) {
    console.error("COSTUME_SHOP_ERROR:", error);
    return jsonResponse({
      success: false,
      message: "코스튬 상점을 불러오지 못했습니다."
    }, 500);
  }
}

async function equipCostume(request) {
  try {
    const { user, db } = await getAuthenticatedUser(request);
    if (!user) return sessionError();

    await normalizeUserCostumeState(db, user);

    const body = await request.json();
    const item = getCostumeItemById(body.itemId);

    if (!item) {
      return jsonResponse({
        success: false,
        message: "존재하지 않는 코스튬입니다."
      }, 404);
    }

    const inventory = Array.isArray(user.costumeInventory)
      ? user.costumeInventory.map(String)
      : [];

    if (
      COSTUME_SHOP_CONFIG.mode === "PAID" &&
      !inventory.includes(item.id)
    ) {
      return jsonResponse({
        success: false,
        message: "먼저 코스튬을 구매해주세요."
      }, 403);
    }

    const character = normalizeCharacterState(user.character);
    character[item.layer] = item.asset;
    character.costumeVersion = COSTUME_SHOP_CONFIG.costumeVersion;

    await db.collection("users").updateOne(
      { _id: user._id, status: "ACTIVE" },
      {
        $set: {
          character,
          updatedAt: new Date()
        }
      }
    );

    return jsonResponse({
      success: true,
      message: `${item.name}을(를) 장착했습니다.`,
      character,
      point: Number(user.point || 0),
      equippedItemId: item.id
    });
  } catch (error) {
    console.error("COSTUME_EQUIP_ERROR:", error);
    return jsonResponse({
      success: false,
      message: "코스튬을 장착하지 못했습니다."
    }, 500);
  }
}

async function unequipCostume(request) {
  try {
    const { user, db } = await getAuthenticatedUser(request);
    if (!user) return sessionError();

    await normalizeUserCostumeState(db, user);

    const body = await request.json();
    const layer = String(body.layer || "");

    if (!isEquipLayer(layer)) {
      return jsonResponse({
        success: false,
        message: "올바르지 않은 코스튬 위치입니다."
      }, 400);
    }

    const character = normalizeCharacterState(user.character);
    character[layer] = layer === "expression"
      ? DEFAULT_CHARACTER_STATE.expression
      : null;
    character.costumeVersion = COSTUME_SHOP_CONFIG.costumeVersion;

    await db.collection("users").updateOne(
      { _id: user._id, status: "ACTIVE" },
      {
        $set: {
          character,
          updatedAt: new Date()
        }
      }
    );

    return jsonResponse({
      success: true,
      message: "해당 코스튬을 해제했습니다.",
      character,
      point: Number(user.point || 0)
    });
  } catch (error) {
    console.error("COSTUME_UNEQUIP_ERROR:", error);
    return jsonResponse({
      success: false,
      message: "코스튬을 해제하지 못했습니다."
    }, 500);
  }
}

async function resetEquipped(request) {
  try {
    const { user, db } = await getAuthenticatedUser(request);
    if (!user) return sessionError();

    const character = normalizeCharacterState(null);

    await db.collection("users").updateOne(
      { _id: user._id, status: "ACTIVE" },
      {
        $set: {
          character,
          updatedAt: new Date()
        }
      }
    );

    return jsonResponse({
      success: true,
      message: "장착한 코스튬을 모두 해제했습니다.",
      character,
      point: Number(user.point || 0)
    });
  } catch (error) {
    console.error("COSTUME_RESET_ERROR:", error);
    return jsonResponse({
      success: false,
      message: "코스튬을 초기화하지 못했습니다."
    }, 500);
  }
}

async function purchaseCostume(request) {
  try {
    if (COSTUME_SHOP_CONFIG.mode !== "PAID") {
      return jsonResponse({
        success: false,
        message: "현재는 테스트 기간이라 구매 없이 바로 장착할 수 있습니다."
      }, 409);
    }

    const { user, db } = await getAuthenticatedUser(request);
    if (!user) return sessionError();

    await normalizeUserCostumeState(db, user);

    const body = await request.json();
    const item = getCostumeItemById(body.itemId);

    if (!item) {
      return jsonResponse({ success: false, message: "존재하지 않는 코스튬입니다." }, 404);
    }

    const price = Number(item.price);
    if (!Number.isInteger(price) || price < 0) {
      return jsonResponse({
        success: false,
        message: "아직 가격이 설정되지 않은 코스튬입니다."
      }, 409);
    }

    const inventory = Array.isArray(user.costumeInventory)
      ? user.costumeInventory.map(String)
      : [];

    if (inventory.includes(item.id)) {
      return jsonResponse({
        success: true,
        alreadyOwned: true,
        message: "이미 보유한 코스튬입니다.",
        point: Number(user.point || 0),
        ownedCostumes: inventory
      });
    }

    const updated = await db.collection("users").findOneAndUpdate(
      {
        _id: user._id,
        status: "ACTIVE",
        point: { $gte: price },
        costumeInventory: { $ne: item.id }
      },
      {
        $inc: { point: -price },
        $addToSet: { costumeInventory: item.id },
        $set: { updatedAt: new Date() }
      },
      {
        returnDocument: "after",
        projection: { point: 1, costumeInventory: 1 }
      }
    );

    if (!updated) {
      return jsonResponse({
        success: false,
        message: "점수가 부족하거나 이미 구매한 코스튬입니다."
      }, 409);
    }

    return jsonResponse({
      success: true,
      message: `${item.name}을(를) 구매했습니다.`,
      point: Number(updated.point || 0),
      ownedCostumes: updated.costumeInventory || []
    });
  } catch (error) {
    console.error("COSTUME_PURCHASE_ERROR:", error);
    return jsonResponse({
      success: false,
      message: "코스튬을 구매하지 못했습니다."
    }, 500);
  }
}

const COSTUME_ACTION_GUARDS = Object.freeze({
  shop: {
    methods: ["GET"],
    rateLimit: { key: "costume:shop", limit: 60, windowMs: 60_000 }
  },
  equip: {
    methods: ["POST"], json: true, maxBodyBytes: 4 * 1024,
    rateLimit: { key: "costume:equip", limit: 30, windowMs: 60_000 }
  },
  unequip: {
    methods: ["POST"], json: true, maxBodyBytes: 4 * 1024,
    rateLimit: { key: "costume:unequip", limit: 30, windowMs: 60_000 }
  },
  "reset-equipped": {
    methods: ["POST"], json: true, maxBodyBytes: 2 * 1024,
    rateLimit: { key: "costume:reset", limit: 10, windowMs: 60_000 }
  },
  purchase: {
    methods: ["POST"], json: true, maxBodyBytes: 4 * 1024,
    rateLimit: { key: "costume:purchase", limit: 20, windowMs: 60_000 }
  }
});

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const action = url.searchParams.get("action");
    const actionGuard = COSTUME_ACTION_GUARDS[action];

    if (actionGuard) {
      const requestGuard = await guardApiRequest(request, actionGuard);
      if (requestGuard) return requestGuard;
    }

    switch (action) {
      case "shop": return getShop(request);
      case "equip": return equipCostume(request);
      case "unequip": return unequipCostume(request);
      case "reset-equipped": return resetEquipped(request);
      case "purchase": return purchaseCostume(request);
      default:
        return jsonResponse({
          success: false,
          message: "존재하지 않는 코스튬 API입니다."
        }, 404);
    }
  }
};
