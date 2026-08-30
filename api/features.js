import {
  ObjectId
} from "mongodb";

import {
  getDatabase
} from "../lib/mongodb.js";

import {
  getSessionFromRequest
} from "../lib/auth.js";

import {
  guardApiRequest
} from "../lib/api.js";


// =========================================================
// JSON 응답
// =========================================================

function jsonResponse(
  data,
  status = 200
) {

  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {

        "Content-Type":
          "application/json; charset=utf-8",

        "Cache-Control":
          "no-store"
      }
    }
  );
}


// =========================================================
// 좋아요
// =========================================================

async function toggleLike(
  request
) {

  if (
    request.method !==
    "POST"
  ) {

    return jsonResponse(
      {
        success: false,
        message:
          "POST 요청만 사용할 수 있습니다."
      },
      405
    );
  }


  try {

    const session =
      await getSessionFromRequest(
        request
      );


    if (!session) {

      return jsonResponse(
        {
          success: false,
          sessionExpired: true,
          message:
            "로그인이 필요합니다."
        },
        401
      );
    }


    const body =
      await request.json();


    const quizId =
      String(
        body.quizId || ""
      );


    if (
      !ObjectId.isValid(
        quizId
      )
    ) {

      return jsonResponse(
        {
          success: false,
          message:
            "올바르지 않은 퀴즈입니다."
        },
        400
      );
    }


    const db =
      await getDatabase();


    const quizzes =
      db.collection(
        "quizzes"
      );


    const likes =
      db.collection(
        "quizLikes"
      );


    const objectId =
      new ObjectId(
        quizId
      );


    const quiz =
      await quizzes.findOne({

        _id:
          objectId,

        status:
          "ACTIVE"

      });


    if (!quiz) {

      return jsonResponse(
        {
          success: false,
          message:
            "퀴즈를 찾을 수 없습니다."
        },
        404
      );
    }


    const existing =
      await likes.findOne({

        quizId:
          objectId,

        userId:
          session.userId

      });


    // =====================================================
    // 이미 좋아요 → 취소
    // =====================================================

    if (existing) {

      const deleted =
        await likes.deleteOne({

          _id:
            existing._id

        });


      if (
        deleted.deletedCount >
        0
      ) {

        await quizzes.updateOne(

          {
            _id:
              objectId,

            likeCount: {
              $gt: 0
            }
          },

          {
            $inc: {
              likeCount: -1
            }
          }

        );
      }

    } else {

      // ===================================================
      // 좋아요 추가
      // ===================================================

      try {

        await likes.insertOne({

          quizId:
            objectId,

          userId:
            session.userId,

          createdAt:
            new Date()

        });


        await quizzes.updateOne(

          {
            _id:
              objectId
          },

          {
            $inc: {
              likeCount: 1
            }
          }

        );

      } catch (error) {

        // 중복 클릭으로 인한 unique index 오류
        if (
          error.code !==
          11000
        ) {

          throw error;
        }
      }
    }


    // =====================================================
    // 최종 서버 상태
    // =====================================================

    const [
      currentLike,
      updatedQuiz
    ] =
      await Promise.all([

        likes.findOne({

          quizId:
            objectId,

          userId:
            session.userId

        }),

        quizzes.findOne(
          {
            _id:
              objectId
          },
          {
            projection: {
              likeCount: 1
            }
          }
        )

      ]);


    return jsonResponse({

      success: true,

      liked:
        Boolean(
          currentLike
        ),

      likeCount:
        Number(
          updatedQuiz
            ?.likeCount ||
          0
        )

    });


  } catch (error) {

    console.error(
      "TOGGLE_LIKE_ERROR:",
      error
    );


    return jsonResponse(
      {
        success: false,
        message:
          "좋아요 처리 중 오류가 발생했습니다."
      },
      500
    );
  }
}


// =========================================================
// 랭킹
// =========================================================

async function ranking(
  request
) {

  if (
    request.method !==
    "GET"
  ) {

    return jsonResponse(
      {
        success: false,
        message:
          "GET 요청만 사용할 수 있습니다."
      },
      405
    );
  }


  try {

    const session =
      await getSessionFromRequest(
        request
      );


    if (!session) {

      return jsonResponse(
        {
          success: false,
          sessionExpired: true,
          message:
            "로그인이 필요합니다."
        },
        401
      );
    }


    const db =
      await getDatabase();


    const users =
      db.collection(
        "users"
      );


    // =====================================================
    // 현재 사용자
    // =====================================================

    const me =
      await users.findOne({

        _id:
          session.userId,

        status:
          "ACTIVE"

      });


    if (!me) {

      return jsonResponse(
        {
          success: false,
          sessionExpired: true,
          message:
            "사용자를 찾을 수 없습니다."
        },
        401
      );
    }


    // =====================================================
    // 전체 참가자 수 + TOP 30
    // =====================================================

    const [
      totalParticipants,
      topUsers
    ] =
      await Promise.all([

        users.countDocuments({
          status:
            "ACTIVE"
        }),

        users
          .find({
            status:
              "ACTIVE"
          })
          .sort({

            totalScore:
              -1,

            createdAt:
              1,

            _id:
              1

          })
          .limit(
            30
          )
          .project({

            nickname:
              1,

            totalScore:
              1,

            point:
              1,

            character:
              1,

            role:
              1,

            createdAt:
              1

          })
          .toArray()

      ]);


    const myScore =
      Number(
        me.totalScore ||
        0
      );


    // =====================================================
    // 내 순위
    // =====================================================

    const beforeMe =
      await users.countDocuments({

        status:
          "ACTIVE",

        $or: [

          {
            totalScore: {
              $gt:
                myScore
            }
          },

          {
            totalScore:
              myScore,

            createdAt: {
              $lt:
                me.createdAt
            }
          },

          {
            totalScore:
              myScore,

            createdAt:
              me.createdAt,

            _id: {
              $lt:
                me._id
            }
          }

        ]

      });


    return jsonResponse({

      success:
        true,

      totalParticipants:
        totalParticipants,

      rankings:
        topUsers.map(
          function(
            user,
            index
          ) {

            return {

              rank:
                index + 1,

              id:
                user._id
                  .toString(),

              nickname:
                user.nickname ||
                "사용자",

              totalScore:
                Number(
                  user.totalScore ||
                  0
                ),

              point:
                Number(
                  user.point ||
                  0
                ),

              character:
                user.character ||
                "default",

              role:
                user.role ||
                "USER"

            };
          }
        ),

      me: {

        rank:
          beforeMe +
          1,

        id:
          me._id
            .toString(),

        nickname:
          me.nickname ||
          "사용자",

        point:
          Number(
            me.point ||
            0
          ),

        totalScore:
          myScore,

        character:
          me.character ||
          "default",

        role:
          me.role ||
          "USER"

      }

    });


  } catch (error) {

    console.error(
      "RANKING_ERROR:",
      error
    );


    return jsonResponse(
      {
        success: false,
        message:
          "랭킹을 불러오는 중 오류가 발생했습니다."
      },
      500
    );
  }
}


const FEATURE_ACTION_GUARDS = Object.freeze({
  "toggle-like": { methods: ["POST"], json: true, maxBodyBytes: 8 * 1024, rateLimit: { key: "features:quiz-like", limit: 60, windowMs: 60_000 } },
  ranking: { methods: ["GET"], rateLimit: { key: "features:ranking", limit: 60, windowMs: 60_000 } }
});

// =========================================================
// Router
// =========================================================

export default {

  async fetch(request) {

    const url =
      new URL(
        request.url
      );


    const action =
      url.searchParams.get(
        "action"
      );


    const actionGuard =
      FEATURE_ACTION_GUARDS[action];


    if (actionGuard) {
      const requestGuard =
        await guardApiRequest(
          request,
          actionGuard
        );

      if (requestGuard) {
        return requestGuard;
      }
    }


    switch (action) {

      case "toggle-like":

        return toggleLike(
          request
        );


      case "ranking":

        return ranking(
          request
        );


      default:

        return jsonResponse(
          {
            success: false,
            message:
              "존재하지 않는 부가 기능 API입니다."
          },
          404
        );
    }
  }

};