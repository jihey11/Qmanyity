import { randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";

import { getDatabase } from "../lib/mongodb.js";
import { getSessionFromRequest } from "../lib/auth.js";
import { guardApiRequest } from "../lib/api.js";
import {
  BOARD_COLLECTIONS,
  BOARD_STATUS,
  normalizeBoardAdditionalCategories
} from "../lib/board.js";

const GLOBAL_ROOM_ID = "global";

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ...extraHeaders
      }
    }
  );
}

function text(value, maxLength = 1000) {
  return String(value ?? "")
    .trim()
    .slice(0, maxLength);
}

function normalizeAnswer(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getReward(difficulty) {
  if (difficulty === "쉬움") return 10;
  if (difficulty === "어려움") return 30;
  return 20;
}

function toObjectId(value) {
  const id = String(value || "").trim();
  return ObjectId.isValid(id)
    ? new ObjectId(id)
    : null;
}

async function getAdminAuth(request) {
  const session = await getSessionFromRequest(request);

  if (!session) {
    return {
      error: jsonResponse(
        {
          success: false,
          sessionExpired: true,
          message: "로그인이 필요합니다."
        },
        401
      )
    };
  }

  const db = await getDatabase();
  const user = await db.collection("users").findOne(
    {
      _id: session.userId,
      status: "ACTIVE"
    },
    {
      projection: {
        _id: 1,
        nickname: 1,
        role: 1
      }
    }
  );

  if (!user) {
    return {
      error: jsonResponse(
        {
          success: false,
          sessionExpired: true,
          message: "사용자를 찾을 수 없습니다."
        },
        401
      )
    };
  }

  if (String(user.role || "").toUpperCase() !== "ADMIN") {
    return {
      error: jsonResponse(
        {
          success: false,
          message: "관리자만 사용할 수 있는 기능입니다."
        },
        403
      )
    };
  }

  return { db, user };
}

function serializeAdminCategory(category) {
  return {
    id: String(category._id),
    name: String(category.name || ""),
    isFixed: Boolean(category.isFixed),
    displayOrder: Number(category.displayOrder || 0),
    active: category.active !== false
  };
}

function isEtcCategory(category) {
  return (
    String(category?._id || category?.id || "") === "etc" ||
    String(category?.name || "").trim() === "기타"
  );
}

function sortCategoriesWithEtcLast(categories) {
  const list = Array.isArray(categories) ? [...categories] : [];
  const normal = list.filter(category => !isEtcCategory(category));
  const etc = list.filter(category => isEtcCategory(category));
  return [...normal, ...etc];
}

// 새 카테고리를 추가한 뒤 DB의 displayOrder도 다시 정리한다.
// 이렇게 하면 기존에 기타 뒤에 생성된 사용자 카테고리도 모두
// 기타 앞으로 이동하고, 이후 추가되는 카테고리도 기타 바로 앞에 쌓인다.
async function normalizeActiveCategoryDisplayOrder(db) {
  const categories = await db.collection("categories")
    .find({ active: true })
    .sort({ displayOrder: 1, name: 1 })
    .project({ name: 1, isFixed: 1, displayOrder: 1, active: 1 })
    .toArray();

  const ordered = sortCategoriesWithEtcLast(categories);

  if (!ordered.length) {
    return [];
  }

  const alreadyNormalized = ordered.every(
    (category, index) => Number(category.displayOrder || 0) === index + 1
  );

  if (alreadyNormalized) {
    return ordered.map((category, index) => ({
      ...category,
      displayOrder: index + 1
    }));
  }

  const now = new Date();

  // 예전에 999999, 1000000 같은 큰 순서값을 사용했거나
  // 혹시 displayOrder에 unique 인덱스가 남아 있어도 충돌하지 않도록
  // 먼저 임시로 아주 큰 서로 다른 값으로 이동한 뒤 1,2,3...으로 정리한다.
  const tempBase = Date.now() * 1000;

  const tempOperations = ordered.map((category, index) => ({
    updateOne: {
      filter: { _id: category._id },
      update: {
        $set: {
          displayOrder: tempBase + index + 1,
          updatedAt: now
        }
      }
    }
  }));

  await db.collection("categories").bulkWrite(tempOperations, { ordered: true });

  const finalOperations = ordered.map((category, index) => ({
    updateOne: {
      filter: { _id: category._id },
      update: {
        $set: {
          displayOrder: index + 1,
          updatedAt: now
        }
      }
    }
  }));

  await db.collection("categories").bulkWrite(finalOperations, { ordered: true });

  return ordered.map((category, index) => ({
    ...category,
    displayOrder: index + 1,
    updatedAt: now
  }));
}

function serializeAdminQuiz(quiz, writerMap = new Map()) {
  return {
    id: quiz._id?.toString() || "",
    title: String(quiz.title || ""),
    categoryId: String(quiz.categoryId || ""),
    category: String(quiz.categoryOriginalName || "기타"),
    difficulty: String(quiz.difficulty || "보통"),
    questionType: String(quiz.questionType || ""),
    writer: writerMap.get(String(quiz.writerId || "")) || "알 수 없음",
    likeCount: Number(quiz.likeCount || 0),
    playCount: Number(quiz.playCount || 0),
    wrongCount: Number(quiz.wrongCount || 0),
    version: Number(quiz.version || 1),
    createdAt: quiz.createdAt || null,
    updatedAt: quiz.updatedAt || null
  };
}

function serializeAdminPost(post) {
  return {
    id: post._id?.toString() || "",
    title: String(post.title || ""),
    content: String(post.content || ""),
    authorNickname: String(post.authorNickname || "알 수 없음"),
    additionalCategories: normalizeBoardAdditionalCategories(
      post.additionalCategory
    ),
    likeCount: Number(post.likeCount || 0),
    commentCount: Number(post.commentCount || 0),
    viewCount: Number(post.viewCount || 0),
    createdAt: post.createdAt || null,
    updatedAt: post.updatedAt || null
  };
}

function serializeAdminChatMessage(message) {
  return {
    id: message._id?.toString() || "",
    senderNickname: String(message.senderNickname || "알 수 없음"),
    text: String(message.text || ""),
    createdAt: message.createdAt || null,
    updatedAt: message.updatedAt || null
  };
}

async function overview(request) {
  const auth = await getAdminAuth(request);
  if (auth.error) return auth.error;

  const { db } = auth;

  try {
    // 순서 복구는 보조 작업이다. 실패해도 관리자 화면은 정상적으로 연다.
    try {
      await normalizeActiveCategoryDisplayOrder(db);
    } catch (orderError) {
      console.warn("ADMIN_CATEGORY_ORDER_REPAIR_WARNING:", orderError);
    }

    const [
      categories,
      quizzes,
      posts,
      chatMessages,
      categoryCount,
      quizCount,
      postCount,
      chatCount
    ] = await Promise.all([
      db.collection("categories")
        .find({ active: true })
        .sort({ displayOrder: 1, name: 1 })
        .project({ name: 1, isFixed: 1, displayOrder: 1, active: 1 })
        .toArray(),

      db.collection("quizzes")
        .find({ status: "ACTIVE" })
        .sort({ createdAt: -1 })
        .project({
          title: 1,
          categoryId: 1,
          categoryOriginalName: 1,
          difficulty: 1,
          questionType: 1,
          writerId: 1,
          likeCount: 1,
          playCount: 1,
          wrongCount: 1,
          version: 1,
          createdAt: 1,
          updatedAt: 1
        })
        .toArray(),

      db.collection(BOARD_COLLECTIONS.POSTS)
        .find({ status: BOARD_STATUS.ACTIVE })
        .sort({ createdAt: -1 })
        .project({
          title: 1,
          content: 1,
          authorNickname: 1,
          additionalCategory: 1,
          likeCount: 1,
          commentCount: 1,
          viewCount: 1,
          createdAt: 1,
          updatedAt: 1
        })
        .toArray(),

      db.collection("communityMessages")
        .find({
          roomId: GLOBAL_ROOM_ID,
          type: "CHAT",
          status: { $ne: "DELETED" }
        })
        .sort({ createdAt: -1 })
        .project({
          senderNickname: 1,
          text: 1,
          createdAt: 1,
          updatedAt: 1
        })
        .toArray(),

      db.collection("categories").countDocuments({ active: true }),
      db.collection("quizzes").countDocuments({ status: "ACTIVE" }),
      db.collection(BOARD_COLLECTIONS.POSTS).countDocuments({
        status: BOARD_STATUS.ACTIVE
      }),
      db.collection("communityMessages").countDocuments({
        roomId: GLOBAL_ROOM_ID,
        type: "CHAT",
        status: { $ne: "DELETED" }
      })
    ]);

    const writerIds = [
      ...new Map(
        quizzes
          .filter(quiz => quiz.writerId)
          .map(quiz => [String(quiz.writerId), quiz.writerId])
      ).values()
    ];

    const writers = writerIds.length
      ? await db.collection("users")
          .find(
            { _id: { $in: writerIds } },
            { projection: { nickname: 1 } }
          )
          .toArray()
      : [];

    const writerMap = new Map(
      writers.map(user => [user._id.toString(), user.nickname || "알 수 없음"])
    );

    return jsonResponse({
      success: true,
      counts: {
        categories: Number(categoryCount || 0),
        quizzes: Number(quizCount || 0),
        posts: Number(postCount || 0),
        chats: Number(chatCount || 0)
      },
      categories: sortCategoriesWithEtcLast(categories).map(serializeAdminCategory),
      quizzes: quizzes.map(quiz => serializeAdminQuiz(quiz, writerMap)),
      posts: posts.map(serializeAdminPost),
      chatMessages: chatMessages.map(serializeAdminChatMessage)
    });
  } catch (error) {
    console.error("ADMIN_OVERVIEW_ERROR:", error);
    return jsonResponse(
      {
        success: false,
        message: "관리자 데이터를 불러오지 못했습니다."
      },
      500
    );
  }
}

async function getNextCategoryDisplayOrder(db) {
  const categories = db.collection("categories");

  // active 카테고리만 보면 삭제된 카테고리의 displayOrder와 겹칠 수 있다.
  // 예전에 displayOrder에 unique 인덱스가 만들어졌던 DB도 안전하게 처리하기 위해
  // 비활성 카테고리까지 포함해서 현재 가장 큰 숫자 다음 값을 사용한다.
  const last = await categories
    .find({ displayOrder: { $type: "number" } })
    .sort({ displayOrder: -1 })
    .limit(1)
    .project({ displayOrder: 1 })
    .toArray();

  let candidate = Math.max(0, Number(last[0]?.displayOrder || 0)) + 1;

  // 혹시 숫자 타입이 섞여 있거나 동시에 추가 요청이 들어와도
  // 이미 사용 중인 순서값은 건너뛴다.
  for (let attempt = 0; attempt < 50; attempt++) {
    const occupied = await categories.findOne(
      { displayOrder: candidate },
      { projection: { _id: 1 } }
    );

    if (!occupied) return candidate;
    candidate += 1;
  }

  // 사실상 도달하지 않지만 마지막 안전장치다.
  return Date.now();
}

function categoryNameQuery(name) {
  return {
    $regex: `^${String(name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
    $options: "i"
  };
}

async function restoreInactiveCategory(db, category, name) {
  const now = new Date();
  const displayOrder = await getNextCategoryDisplayOrder(db);
  const nameLower = String(name || "").trim().toLocaleLowerCase("ko-KR");

  const result = await db.collection("categories").findOneAndUpdate(
    {
      _id: category._id,
      active: { $ne: true }
    },
    {
      $set: {
        name,
        nameLower,
        active: true,
        displayOrder,
        updatedAt: now
      },
      $unset: {
        deletedAt: ""
      }
    },
    {
      returnDocument: "after"
    }
  );

  return result || null;
}

async function categoryCreate(request) {
  const auth = await getAdminAuth(request);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const name = String(body.name || "").trim();

    if (name.length < 1 || name.length > 30) {
      return jsonResponse(
        { success: false, message: "카테고리 이름은 1~30자로 입력해주세요." },
        400
      );
    }

    const categories = auth.db.collection("categories");

    // 화면에는 active:true만 보이므로, 삭제된 같은 이름의 카테고리가 DB에 남아 있으면
    // 사용자는 중복을 볼 수 없지만 MongoDB의 과거 unique 인덱스에는 걸릴 수 있다.
    // 따라서 active 여부와 상관없이 먼저 같은 이름을 찾는다.
    const sameNameCategory = await categories.findOne({
      name: categoryNameQuery(name)
    });

    if (sameNameCategory?.active === true) {
      return jsonResponse(
        { success: false, message: "이미 사용 중인 카테고리 이름입니다." },
        409
      );
    }

    // 삭제된 동일 카테고리가 있으면 새 문서를 만들지 않고 복구한다.
    // 이렇게 하면 name/nameLower에 legacy unique 인덱스가 남아 있어도 충돌하지 않는다.
    if (sameNameCategory) {
      let restored = null;

      try {
        restored = await restoreInactiveCategory(
          auth.db,
          sameNameCategory,
          name
        );
      } catch (restoreError) {
        // displayOrder legacy unique 인덱스와 동시에 충돌한 경우 새 순서값으로 한 번 더 시도한다.
        if (restoreError?.code === 11000) {
          restored = await restoreInactiveCategory(
            auth.db,
            sameNameCategory,
            name
          );
        } else {
          throw restoreError;
        }
      }

      if (!restored) {
        const raced = await categories.findOne({
          name: categoryNameQuery(name),
          active: true
        });

        if (raced) {
          return jsonResponse(
            { success: false, message: "이미 사용 중인 카테고리 이름입니다." },
            409
          );
        }

        return jsonResponse(
          { success: false, message: "카테고리를 다시 활성화하지 못했습니다." },
          409
        );
      }

      try {
        const normalizedCategories =
          await normalizeActiveCategoryDisplayOrder(auth.db);
        const normalized = normalizedCategories.find(
          item => String(item._id) === String(restored._id)
        );
        if (normalized) Object.assign(restored, normalized);
      } catch (orderError) {
        console.warn("ADMIN_CATEGORY_ORDER_NORMALIZE_WARNING:", orderError);
      }

      return jsonResponse({
        success: true,
        restored: true,
        category: serializeAdminCategory(restored)
      });
    }

    const now = new Date();
    const document = {
      _id: `custom-${Date.now()}-${randomBytes(3).toString("hex")}`,
      name,
      // 예전 DB에 nameLower unique 인덱스가 남아 있는 경우도 호환한다.
      nameLower: name.toLocaleLowerCase("ko-KR"),
      active: true,
      isFixed: false,
      displayOrder: await getNextCategoryDisplayOrder(auth.db),
      createdAt: now,
      updatedAt: now
    };

    // 동시에 카테고리를 추가하는 경우 displayOrder가 겹칠 수 있으므로
    // displayOrder 중복이면 새 순서값을 받아 몇 번 재시도한다.
    let inserted = false;

    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      try {
        await categories.insertOne(document);
        inserted = true;
      } catch (insertError) {
        if (insertError?.code !== 11000) throw insertError;

        // 같은 이름이 이미 저장된 경우는 화면 갱신으로 해결할 수 있도록 명확히 안내한다.
        const duplicateName = await categories.findOne({
          name: categoryNameQuery(name)
        });

        if (duplicateName) {
          if (duplicateName.active === true) {
            return jsonResponse(
              { success: false, message: "이미 사용 중인 카테고리 이름입니다." },
              409
            );
          }

          const restored = await restoreInactiveCategory(
            auth.db,
            duplicateName,
            name
          );

          if (restored) {
            try {
              await normalizeActiveCategoryDisplayOrder(auth.db);
            } catch (orderError) {
              console.warn("ADMIN_CATEGORY_ORDER_NORMALIZE_WARNING:", orderError);
            }

            return jsonResponse({
              success: true,
              restored: true,
              category: serializeAdminCategory(restored)
            });
          }
        }

        document.displayOrder = await getNextCategoryDisplayOrder(auth.db);
      }
    }

    if (!inserted) {
      return jsonResponse(
        {
          success: false,
          message: "카테고리 순서값 충돌을 해결하지 못했습니다. 다시 시도해주세요."
        },
        409
      );
    }

    // 순서 정리는 보조 작업이다. 실패해도 생성 자체는 성공으로 유지한다.
    try {
      const normalizedCategories =
        await normalizeActiveCategoryDisplayOrder(auth.db);
      const normalizedDocument = normalizedCategories.find(
        category => String(category._id) === String(document._id)
      );
      if (normalizedDocument) Object.assign(document, normalizedDocument);
    } catch (orderError) {
      console.warn("ADMIN_CATEGORY_ORDER_NORMALIZE_WARNING:", orderError);
    }

    return jsonResponse({
      success: true,
      category: serializeAdminCategory(document)
    });
  } catch (error) {
    console.error("ADMIN_CATEGORY_CREATE_ERROR:", error);

    return jsonResponse(
      {
        success: false,
        message:
          error?.code === 11000
            ? "숨겨진 기존 카테고리 또는 순서값과 충돌했습니다. 관리자 페이지를 새로고침한 뒤 다시 시도해주세요."
            : "카테고리를 추가하지 못했습니다."
      },
      error?.code === 11000 ? 409 : 500
    );
  }
}

async function categoryUpdate(request) {
  const auth = await getAdminAuth(request);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const categoryId = text(body.categoryId, 120);
    const name = String(body.name || "").trim();

    if (!categoryId) {
      return jsonResponse(
        { success: false, message: "카테고리를 확인해주세요." },
        400
      );
    }

    if (name.length < 1 || name.length > 30) {
      return jsonResponse(
        { success: false, message: "카테고리 이름은 1~30자로 입력해주세요." },
        400
      );
    }

    const category = await auth.db.collection("categories").findOne({
      _id: categoryId,
      active: true
    });

    if (!category) {
      return jsonResponse(
        { success: false, message: "카테고리를 찾을 수 없습니다." },
        404
      );
    }

    const duplicate = await auth.db.collection("categories").findOne({
      _id: { $ne: categoryId },
      name: {
        $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        $options: "i"
      },
      active: true
    });

    if (duplicate) {
      return jsonResponse(
        { success: false, message: "이미 사용 중인 카테고리 이름입니다." },
        409
      );
    }

    const now = new Date();

    await Promise.all([
      auth.db.collection("categories").updateOne(
        { _id: categoryId, active: true },
        { $set: { name, updatedAt: now } }
      ),
      auth.db.collection("quizzes").updateMany(
        { categoryId, status: "ACTIVE" },
        { $set: { categoryOriginalName: name, updatedAt: now } }
      )
    ]);

    category.name = name;
    category.updatedAt = now;

    try {
      await normalizeActiveCategoryDisplayOrder(auth.db);
    } catch (orderError) {
      console.warn("ADMIN_CATEGORY_ORDER_NORMALIZE_WARNING:", orderError);
    }

    return jsonResponse({
      success: true,
      category: serializeAdminCategory(category)
    });
  } catch (error) {
    console.error("ADMIN_CATEGORY_UPDATE_ERROR:", error);
    return jsonResponse(
      { success: false, message: "카테고리를 수정하지 못했습니다." },
      500
    );
  }
}

async function categoryDelete(request) {
  const auth = await getAdminAuth(request);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const categoryId = text(body.categoryId, 120);

    if (!categoryId) {
      return jsonResponse(
        { success: false, message: "카테고리를 확인해주세요." },
        400
      );
    }

    const categories = await auth.db.collection("categories")
      .find({ active: true })
      .sort({ displayOrder: 1 })
      .project({ name: 1, displayOrder: 1 })
      .toArray();

    const target = categories.find(item => String(item._id) === categoryId);

    if (!target) {
      return jsonResponse(
        { success: false, message: "카테고리를 찾을 수 없습니다." },
        404
      );
    }

    if (categories.length <= 1) {
      return jsonResponse(
        { success: false, message: "카테고리는 최소 1개 이상 필요합니다." },
        409
      );
    }

    const fallback =
      categories.find(item => String(item._id) !== categoryId && String(item._id) === "etc") ||
      categories.find(item => String(item._id) !== categoryId);

    const now = new Date();

    await Promise.all([
      auth.db.collection("categories").updateOne(
        { _id: categoryId, active: true },
        {
          $set: {
            active: false,
            deletedAt: now,
            updatedAt: now
          }
        }
      ),
      auth.db.collection("quizzes").updateMany(
        { categoryId, status: "ACTIVE" },
        {
          $set: {
            categoryId: fallback._id,
            categoryOriginalName: fallback.name,
            updatedAt: now
          }
        }
      )
    ]);

    try {
      await normalizeActiveCategoryDisplayOrder(auth.db);
    } catch (orderError) {
      console.warn("ADMIN_CATEGORY_ORDER_NORMALIZE_WARNING:", orderError);
    }

    return jsonResponse({
      success: true,
      categoryId,
      fallbackCategory: {
        id: String(fallback._id),
        name: String(fallback.name || "기타")
      }
    });
  } catch (error) {
    console.error("ADMIN_CATEGORY_DELETE_ERROR:", error);
    return jsonResponse(
      { success: false, message: "카테고리를 삭제하지 못했습니다." },
      500
    );
  }
}

function serializeEditableQuiz(quiz) {
  const result = {
    id: quiz._id?.toString() || "",
    title: String(quiz.title || ""),
    question: String(quiz.question || ""),
    categoryId: String(quiz.categoryId || ""),
    categoryOriginalName: String(quiz.categoryOriginalName || "기타"),
    tags: Array.isArray(quiz.tags) ? quiz.tags : [],
    difficulty: String(quiz.difficulty || "보통"),
    questionType: String(quiz.questionType || "MULTIPLE_CHOICE"),
    version: Number(quiz.version || 1),
    answerExplanation: String(quiz.solution?.answerExplanation || ""),
    options: [],
    correctIndex: 0,
    oxAnswer: "O",
    primaryAnswer: "",
    acceptedAnswers: []
  };

  if (quiz.questionType === "MULTIPLE_CHOICE") {
    result.options = (quiz.options || []).map(option => ({
      id: option.id,
      text: option.text
    }));

    const index = result.options.findIndex(
      option => option.id === quiz.solution?.correctOptionId
    );
    result.correctIndex = index >= 0 ? index : 0;
  }

  if (quiz.questionType === "OX") {
    result.oxAnswer = quiz.solution?.correctOptionId === "X" ? "X" : "O";
  }

  if (quiz.questionType === "SHORT_ANSWER") {
    result.primaryAnswer = String(quiz.solution?.primaryAnswer || "");
    result.acceptedAnswers = (quiz.solution?.acceptedAnswers || [])
      .map(answer => String(answer?.text || ""))
      .filter(Boolean);
  }

  return result;
}

async function quizDetail(request) {
  const auth = await getAdminAuth(request);
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const quizId = toObjectId(url.searchParams.get("quizId"));

  if (!quizId) {
    return jsonResponse(
      { success: false, message: "올바르지 않은 퀴즈입니다." },
      400
    );
  }

  try {
    const quiz = await auth.db.collection("quizzes").findOne({
      _id: quizId,
      status: "ACTIVE"
    });

    if (!quiz) {
      return jsonResponse(
        { success: false, message: "퀴즈를 찾을 수 없습니다." },
        404
      );
    }

    return jsonResponse({
      success: true,
      quiz: serializeEditableQuiz(quiz)
    });
  } catch (error) {
    console.error("ADMIN_QUIZ_DETAIL_ERROR:", error);
    return jsonResponse(
      { success: false, message: "퀴즈 정보를 불러오지 못했습니다." },
      500
    );
  }
}

async function validateAdminQuizInput(db, body) {
  const title = text(body.title, 101);
  const question = text(body.question, 1001);
  const categoryId = text(body.categoryId, 120);
  const questionType = text(body.questionType, 40);
  const difficulty = text(body.difficulty, 20);
  const explanation = text(body.answerExplanation, 1001);

  if (title.length < 2 || title.length > 100) {
    return { error: "문제는 2~100자로 입력해주세요." };
  }
  if (question.length > 1000) {
    return { error: "상세 문제는 1000자 이하로 입력해주세요." };
  }
  if (explanation.length > 1000) {
    return { error: "정답 해설은 1000자 이하로 입력해주세요." };
  }
  if (!["MULTIPLE_CHOICE", "OX", "SHORT_ANSWER"].includes(questionType)) {
    return { error: "올바른 문제 유형을 선택해주세요." };
  }
  if (!["쉬움", "보통", "어려움"].includes(difficulty)) {
    return { error: "올바른 난이도를 선택해주세요." };
  }
  if (!categoryId || categoryId === "all") {
    return { error: "카테고리를 선택해주세요." };
  }

  const category = await db.collection("categories").findOne({
    _id: categoryId,
    active: true
  });
  if (!category) {
    return { error: "사용할 수 없는 카테고리입니다." };
  }

  const tags = [];
  const rawTags = Array.isArray(body.tags) ? body.tags : [];
  for (const rawTag of rawTags) {
    const tag = String(rawTag || "").trim().replace(/^#+/, "");
    if (!tag) continue;
    if (tag.length > 20) {
      return { error: "부가 카테고리는 각각 20자 이하로 입력해주세요." };
    }
    if (!tags.some(item => item.toLowerCase() === tag.toLowerCase())) {
      tags.push(tag);
    }
  }
  if (tags.length > 5) {
    return { error: "부가 카테고리는 최대 5개까지 등록할 수 있습니다." };
  }

  let options = [];
  let solution = {};

  if (questionType === "MULTIPLE_CHOICE") {
    const rawOptions = Array.isArray(body.options) ? body.options : [];
    if (rawOptions.length < 2 || rawOptions.length > 10) {
      return { error: "N지선다는 선택지를 2~10개 등록해주세요." };
    }

    options = rawOptions.map((value, index) => ({
      id: `option_${index + 1}`,
      text: String(value || "").trim(),
      order: index + 1
    }));

    if (options.some(option => !option.text || option.text.length > 200)) {
      return { error: "모든 선택지를 1~200자로 입력해주세요." };
    }

    const correctIndex = Number(body.correctIndex);
    if (
      !Number.isInteger(correctIndex) ||
      correctIndex < 0 ||
      correctIndex >= options.length
    ) {
      return { error: "정답 선택지를 지정해주세요." };
    }

    solution = {
      correctOptionId: options[correctIndex].id,
      answerExplanation: explanation
    };
  }

  if (questionType === "OX") {
    const oxAnswer = String(body.oxAnswer || "").toUpperCase();
    if (oxAnswer !== "O" && oxAnswer !== "X") {
      return { error: "OX 정답을 선택해주세요." };
    }

    options = [
      { id: "O", text: "O", order: 1 },
      { id: "X", text: "X", order: 2 }
    ];

    solution = {
      correctOptionId: oxAnswer,
      answerExplanation: explanation
    };
  }

  if (questionType === "SHORT_ANSWER") {
    const primaryAnswer = text(body.primaryAnswer, 101);
    if (!primaryAnswer) {
      return { error: "기본 정답을 입력해주세요." };
    }
    if (primaryAnswer.length > 100) {
      return { error: "서술형 정답은 100자 이하로 입력해주세요." };
    }

    const primaryNormalized = normalizeAnswer(primaryAnswer);
    const acceptedAnswers = [];
    const rawAccepted = Array.isArray(body.acceptedAnswers)
      ? body.acceptedAnswers
      : [];

    for (const rawAnswer of rawAccepted) {
      const answerText = String(rawAnswer || "").trim();
      if (!answerText) continue;
      if (answerText.length > 100) {
        return { error: "추가 인정 정답은 각각 100자 이하로 입력해주세요." };
      }

      const normalized = normalizeAnswer(answerText);
      if (normalized === primaryNormalized) continue;
      if (!acceptedAnswers.some(item => item.normalized === normalized)) {
        acceptedAnswers.push({ text: answerText, normalized });
      }
    }

    if (acceptedAnswers.length > 10) {
      return { error: "추가 인정 정답은 최대 10개까지 등록할 수 있습니다." };
    }

    solution = {
      primaryAnswer,
      primaryNormalized,
      acceptedAnswers,
      answerExplanation: explanation
    };
  }

  return {
    data: {
      title,
      question,
      category,
      tags,
      difficulty,
      reward: getReward(difficulty),
      questionType,
      options,
      solution
    }
  };
}

async function quizUpdate(request) {
  const auth = await getAdminAuth(request);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const quizId = toObjectId(body.quizId);

    if (!quizId) {
      return jsonResponse(
        { success: false, message: "올바르지 않은 퀴즈입니다." },
        400
      );
    }

    const quiz = await auth.db.collection("quizzes").findOne({
      _id: quizId,
      status: "ACTIVE"
    });

    if (!quiz) {
      return jsonResponse(
        { success: false, message: "수정할 퀴즈를 찾을 수 없습니다." },
        404
      );
    }

    const checked = await validateAdminQuizInput(auth.db, body);
    if (checked.error) {
      return jsonResponse(
        { success: false, message: checked.error },
        400
      );
    }

    const data = checked.data;
    const now = new Date();

    await auth.db.collection("quizzes").updateOne(
      { _id: quizId, status: "ACTIVE" },
      {
        $set: {
          title: data.title,
          question: data.question,
          categoryId: data.category._id,
          categoryOriginalName: data.category.name,
          tags: data.tags,
          difficulty: data.difficulty,
          reward: data.reward,
          questionType: data.questionType,
          options: data.options,
          solution: data.solution,
          updatedAt: now
        },
        $inc: { version: 1 }
      }
    );

    return jsonResponse({
      success: true,
      quiz: {
        id: quizId.toString(),
        version: Number(quiz.version || 1) + 1
      }
    });
  } catch (error) {
    console.error("ADMIN_QUIZ_UPDATE_ERROR:", error);
    return jsonResponse(
      { success: false, message: "퀴즈를 수정하지 못했습니다." },
      500
    );
  }
}

async function quizDelete(request) {
  const auth = await getAdminAuth(request);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const quizId = toObjectId(body.quizId);

    if (!quizId) {
      return jsonResponse(
        { success: false, message: "올바르지 않은 퀴즈입니다." },
        400
      );
    }

    const now = new Date();
    const result = await auth.db.collection("quizzes").updateOne(
      { _id: quizId, status: "ACTIVE" },
      {
        $set: {
          status: "DELETED",
          deletedAt: now,
          updatedAt: now
        }
      }
    );

    if (!result.modifiedCount) {
      return jsonResponse(
        { success: false, message: "삭제할 퀴즈를 찾을 수 없습니다." },
        404
      );
    }

    return jsonResponse({ success: true, quizId: quizId.toString() });
  } catch (error) {
    console.error("ADMIN_QUIZ_DELETE_ERROR:", error);
    return jsonResponse(
      { success: false, message: "퀴즈를 삭제하지 못했습니다." },
      500
    );
  }
}

async function postDelete(request) {
  const auth = await getAdminAuth(request);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const postId = toObjectId(body.postId);

    if (!postId) {
      return jsonResponse(
        { success: false, message: "올바르지 않은 게시물입니다." },
        400
      );
    }

    const now = new Date();
    const result = await auth.db.collection(BOARD_COLLECTIONS.POSTS).updateOne(
      { _id: postId, status: BOARD_STATUS.ACTIVE },
      {
        $set: {
          status: BOARD_STATUS.DELETED,
          deletedAt: now,
          updatedAt: now
        }
      }
    );

    if (!result.modifiedCount) {
      return jsonResponse(
        { success: false, message: "삭제할 게시물을 찾을 수 없습니다." },
        404
      );
    }

    await Promise.all([
      auth.db.collection(BOARD_COLLECTIONS.COMMENTS).updateMany(
        { postId, status: BOARD_STATUS.ACTIVE },
        {
          $set: {
            status: BOARD_STATUS.DELETED,
            deletedAt: now,
            updatedAt: now
          }
        }
      ),
      auth.db.collection(BOARD_COLLECTIONS.LIKES).deleteMany({ postId })
    ]);

    return jsonResponse({ success: true, postId: postId.toString() });
  } catch (error) {
    console.error("ADMIN_POST_DELETE_ERROR:", error);
    return jsonResponse(
      { success: false, message: "게시물을 삭제하지 못했습니다." },
      500
    );
  }
}

async function chatDelete(request) {
  const auth = await getAdminAuth(request);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const messageId = toObjectId(body.messageId);

    if (!messageId) {
      return jsonResponse(
        { success: false, message: "올바르지 않은 채팅 메시지입니다." },
        400
      );
    }

    const now = new Date();
    const result = await auth.db.collection("communityMessages").updateOne(
      {
        _id: messageId,
        roomId: GLOBAL_ROOM_ID,
        type: "CHAT",
        status: { $ne: "DELETED" }
      },
      {
        $set: {
          status: "DELETED",
          deletedAt: now,
          updatedAt: now
        }
      }
    );

    if (!result.modifiedCount) {
      return jsonResponse(
        { success: false, message: "삭제할 채팅을 찾을 수 없습니다." },
        404
      );
    }

    return jsonResponse({ success: true, messageId: messageId.toString() });
  } catch (error) {
    console.error("ADMIN_CHAT_DELETE_ERROR:", error);
    return jsonResponse(
      { success: false, message: "채팅 메시지를 삭제하지 못했습니다." },
      500
    );
  }
}

async function chatClear(request) {
  const auth = await getAdminAuth(request);
  if (auth.error) return auth.error;

  try {
    const now = new Date();
    const result = await auth.db.collection("communityMessages").updateMany(
      {
        roomId: GLOBAL_ROOM_ID,
        type: "CHAT",
        status: { $ne: "DELETED" }
      },
      {
        $set: {
          status: "DELETED",
          deletedAt: now,
          updatedAt: now
        }
      }
    );

    return jsonResponse({
      success: true,
      deletedCount: Number(result.modifiedCount || 0)
    });
  } catch (error) {
    console.error("ADMIN_CHAT_CLEAR_ERROR:", error);
    return jsonResponse(
      { success: false, message: "전체 채팅을 정리하지 못했습니다." },
      500
    );
  }
}

const ADMIN_ACTION_GUARDS = Object.freeze({
  overview: {
    methods: ["GET"],
    rateLimit: { key: "admin:overview", limit: 60, windowMs: 60_000 }
  },
  "category-create": {
    methods: ["POST"],
    json: true,
    maxBodyBytes: 8 * 1024,
    rateLimit: { key: "admin:category-create", limit: 20, windowMs: 60_000 }
  },
  "category-update": {
    methods: ["POST"],
    json: true,
    maxBodyBytes: 8 * 1024,
    rateLimit: { key: "admin:category-update", limit: 30, windowMs: 60_000 }
  },
  "category-delete": {
    methods: ["POST"],
    json: true,
    maxBodyBytes: 8 * 1024,
    rateLimit: { key: "admin:category-delete", limit: 20, windowMs: 60_000 }
  },
  "quiz-detail": {
    methods: ["GET"],
    rateLimit: { key: "admin:quiz-detail", limit: 90, windowMs: 60_000 }
  },
  "quiz-update": {
    methods: ["POST"],
    json: true,
    maxBodyBytes: 64 * 1024,
    rateLimit: { key: "admin:quiz-update", limit: 30, windowMs: 60_000 }
  },
  "quiz-delete": {
    methods: ["POST"],
    json: true,
    maxBodyBytes: 8 * 1024,
    rateLimit: { key: "admin:quiz-delete", limit: 30, windowMs: 60_000 }
  },
  "post-delete": {
    methods: ["POST"],
    json: true,
    maxBodyBytes: 8 * 1024,
    rateLimit: { key: "admin:post-delete", limit: 30, windowMs: 60_000 }
  },
  "chat-delete": {
    methods: ["POST"],
    json: true,
    maxBodyBytes: 8 * 1024,
    rateLimit: { key: "admin:chat-delete", limit: 60, windowMs: 60_000 }
  },
  "chat-clear": {
    methods: ["POST"],
    json: true,
    maxBodyBytes: 4 * 1024,
    rateLimit: { key: "admin:chat-clear", limit: 5, windowMs: 60_000 }
  }
});

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const action = String(url.searchParams.get("action") || "");
    const actionGuard = ADMIN_ACTION_GUARDS[action];

    if (!actionGuard) {
      return jsonResponse(
        { success: false, message: "지원하지 않는 관리자 기능입니다." },
        404
      );
    }

    const guardError = await guardApiRequest(request, actionGuard);
    if (guardError) return guardError;

    switch (action) {
      case "overview":
        return overview(request);
      case "category-create":
        return categoryCreate(request);
      case "category-update":
        return categoryUpdate(request);
      case "category-delete":
        return categoryDelete(request);
      case "quiz-detail":
        return quizDetail(request);
      case "quiz-update":
        return quizUpdate(request);
      case "quiz-delete":
        return quizDelete(request);
      case "post-delete":
        return postDelete(request);
      case "chat-delete":
        return chatDelete(request);
      case "chat-clear":
        return chatClear(request);
      default:
        return jsonResponse(
          { success: false, message: "지원하지 않는 관리자 기능입니다." },
          404
        );
    }
  }
};
