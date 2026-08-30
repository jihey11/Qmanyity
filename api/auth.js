import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual
} from "node:crypto";

import {
  promisify
} from "node:util";

import {
  getDatabase
} from "../lib/mongodb.js";

import {
  createSession,
  createSessionCookie,
  createClearSessionCookie,
  getSessionFromRequest,
  deleteSessionFromRequest
} from "../lib/auth.js";

import {
  guardApiRequest
} from "../lib/api.js";


const scrypt =
  promisify(
    scryptCallback
  );


// =========================================================
// JSON 응답
// =========================================================

function jsonResponse(
  data,
  status = 200,
  extraHeaders = {}
) {

  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {

        "Content-Type":
          "application/json; charset=utf-8",

        "Cache-Control":
          "no-store",

        ...extraHeaders
      }
    }
  );
}


// =========================================================
// 회원 공개 정보
// =========================================================

function getPublicUser(
  user
) {

  return {

    id:
      user._id.toString(),

    email:
      user.email,

    nickname:
      user.nickname,

    point:
      Number(
        user.point || 0
      ),

    totalScore:
      Number(
        user.totalScore || 0
      ),

    character:
      user.character ||
      "default",

    role:
      user.role ||
      "USER"
  };
}


// =========================================================
// 비밀번호 검사
// =========================================================

async function verifyPassword(
  password,
  salt,
  storedHash
) {

  try {

    const generated =
      Buffer.from(
        await scrypt(
          password,
          salt,
          64
        )
      );


    const saved =
      Buffer.from(
        storedHash,
        "hex"
      );


    if (
      generated.length !==
      saved.length
    ) {

      return false;
    }


    return timingSafeEqual(
      generated,
      saved
    );

  } catch {

    return false;
  }
}


// =========================================================
// 회원가입
// =========================================================

async function signup(
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

    const body =
      await request.json();


    const email =
      String(
        body.email || ""
      )
      .trim();


    const nickname =
      String(
        body.nickname || ""
      )
      .trim();


    const password =
      String(
        body.password || ""
      );


    const passwordConfirm =
      String(
        body.passwordConfirm || ""
      );


    // 이메일 검사
    const emailPattern =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


    if (
      !emailPattern.test(
        email
      )
    ) {

      return jsonResponse(
        {
          success: false,
          message:
            "올바른 이메일을 입력해주세요."
        },
        400
      );
    }


    // 닉네임
    if (
      !/^[가-힣a-zA-Z0-9_]{2,12}$/.test(
        nickname
      )
    ) {

      return jsonResponse(
        {
          success: false,
          message:
            "닉네임은 한글, 영문, 숫자, _를 사용해 2~12자로 입력해주세요."
        },
        400
      );
    }


    // 비밀번호
    if (
      password.length < 8
    ) {

      return jsonResponse(
        {
          success: false,
          message:
            "비밀번호는 8자 이상으로 입력해주세요."
        },
        400
      );
    }


    if (
      password !==
      passwordConfirm
    ) {

      return jsonResponse(
        {
          success: false,
          message:
            "비밀번호 확인이 일치하지 않습니다."
        },
        400
      );
    }


    const db =
      await getDatabase();


    const users =
      db.collection(
        "users"
      );


    const emailLower =
      email.toLowerCase();


    const nicknameLower =
      nickname.toLowerCase();


    // 중복 확인
    const duplicate =
      await users.findOne({

        $or: [

          {
            emailLower
          },

          {
            nicknameLower
          }

        ]

      });


    if (duplicate) {

      if (
        duplicate.emailLower ===
        emailLower
      ) {

        return jsonResponse(
          {
            success: false,
            message:
              "이미 가입된 이메일입니다."
          },
          409
        );
      }


      return jsonResponse(
        {
          success: false,
          message:
            "이미 사용 중인 닉네임입니다."
        },
        409
      );
    }


    const salt =
      randomBytes(
        16
      )
      .toString(
        "hex"
      );


    const passwordHash =
      Buffer.from(
        await scrypt(
          password,
          salt,
          64
        )
      )
      .toString(
        "hex"
      );


    const now =
      new Date();


    const result =
      await users.insertOne({

        email,

        emailLower,

        nickname,

        nicknameLower,

        passwordHash,

        passwordSalt:
          salt,

        point:
          0,

        totalScore:
          0,

        character:
          "default",

        role:
          "USER",

        status:
          "ACTIVE",

        createdAt:
          now,

        updatedAt:
          now

      });


    return jsonResponse(
      {
        success: true,

        message:
          "회원가입이 완료되었습니다.",

        userId:
          result.insertedId
            .toString()
      },
      201
    );


  } catch (error) {

    console.error(
      "SIGNUP_ERROR:",
      error
    );


    if (
      error.code ===
      11000
    ) {

      return jsonResponse(
        {
          success: false,
          message:
            "이미 사용 중인 이메일 또는 닉네임입니다."
        },
        409
      );
    }


    return jsonResponse(
      {
        success: false,
        message:
          "회원가입 중 서버 오류가 발생했습니다."
      },
      500
    );
  }
}


// =========================================================
// 로그인
// =========================================================

async function login(
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

    const body =
      await request.json();


    const email =
      String(
        body.email || ""
      )
      .trim()
      .toLowerCase();


    const password =
      String(
        body.password || ""
      );


    if (
      !email ||
      !password
    ) {

      return jsonResponse(
        {
          success: false,
          message:
            "이메일과 비밀번호를 입력해주세요."
        },
        400
      );
    }


    const db =
      await getDatabase();


    const user =
      await db
        .collection(
          "users"
        )
        .findOne({

          emailLower:
            email,

          status:
            "ACTIVE"

        });


    if (!user) {

      return jsonResponse(
        {
          success: false,
          message:
            "이메일 또는 비밀번호가 올바르지 않습니다."
        },
        401
      );
    }


    const valid =
      await verifyPassword(

        password,

        user.passwordSalt,

        user.passwordHash

      );


    if (!valid) {

      return jsonResponse(
        {
          success: false,
          message:
            "이메일 또는 비밀번호가 올바르지 않습니다."
        },
        401
      );
    }


    const session =
      await createSession(
        user._id
      );


    return jsonResponse(
      {
        success: true,

        message:
          "로그인되었습니다.",

        user:
          getPublicUser(
            user
          )
      },
      200,
      {
        "Set-Cookie":
          createSessionCookie(
            session.token
          )
      }
    );


  } catch (error) {

    console.error(
      "LOGIN_ERROR:",
      error
    );


    return jsonResponse(
      {
        success: false,
        message:
          "로그인 중 서버 오류가 발생했습니다."
      },
      500
    );
  }
}


// =========================================================
// 로그인 상태 확인
// =========================================================

async function me(
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


    const user =
      await db
        .collection(
          "users"
        )
        .findOne({

          _id:
            session.userId,

          status:
            "ACTIVE"

        });


    if (!user) {

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


    return jsonResponse({

      success: true,

      loggedIn: true,

      user:
        getPublicUser(
          user
        )

    });


  } catch (error) {

    console.error(
      "ME_ERROR:",
      error
    );


    return jsonResponse(
      {
        success: false,
        message:
          "사용자 정보를 불러오지 못했습니다."
      },
      500
    );
  }
}



// =========================================================
// 마이페이지 퀴즈 활동 통계
// =========================================================

async function myStats(
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

    // 사용자 확인, 풀이 통계, 만든 문제 수를 동시에 조회한다.
    // 풀이/오답은 distinct를 두 번 실행하지 않고 한 aggregation에서 계산한다.
    const [
      user,
      attemptStatsRows,
      createdQuizCount
    ] = await Promise.all([

      db
        .collection("users")
        .findOne(
          {
            _id: session.userId,
            status: "ACTIVE"
          },
          {
            projection: {
              _id: 1
            }
          }
        ),

      db
        .collection("quizAttempts")
        .aggregate([
          {
            $match: {
              userId: session.userId
            }
          },
          {
            $group: {
              _id: "$quizId",
              hasWrong: {
                $max: {
                  $cond: [
                    {
                      $eq: [
                        "$isCorrect",
                        false
                      ]
                    },
                    1,
                    0
                  ]
                }
              }
            }
          },
          {
            $group: {
              _id: null,
              attemptedQuizCount: {
                $sum: 1
              },
              wrongQuizCount: {
                $sum: "$hasWrong"
              }
            }
          }
        ])
        .toArray(),

      db
        .collection("quizzes")
        .countDocuments({
          writerId: session.userId,
          status: "ACTIVE"
        })
    ]);

    if (!user) {
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

    const attemptStats =
      attemptStatsRows[0] ||
      {};

    return jsonResponse({
      success: true,
      stats: {
        attemptedQuizCount:
          Number(
            attemptStats.attemptedQuizCount ||
            0
          ),
        wrongQuizCount:
          Number(
            attemptStats.wrongQuizCount ||
            0
          ),
        createdQuizCount:
          Number(
            createdQuizCount ||
            0
          )
      }
    });

  } catch (error) {
    console.error(
      "MY_STATS_ERROR:",
      error
    );

    return jsonResponse(
      {
        success: false,
        message:
          "마이페이지 활동 통계를 불러오지 못했습니다."
      },
      500
    );
  }
}


// =========================================================
// 닉네임 변경
// =========================================================

async function updateNickname(
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
      405,
      {
        "Allow":
          "POST"
      }
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


    const nickname =
      String(
        body.nickname ||
        ""
      )
      .trim();


    if (
      !/^[가-힣a-zA-Z0-9_]{2,12}$/.test(
        nickname
      )
    ) {
      return jsonResponse(
        {
          success: false,
          message:
            "닉네임은 한글, 영문, 숫자, _를 사용해 2~12자로 입력해주세요."
        },
        400
      );
    }


    const db =
      await getDatabase();

    const users =
      db.collection(
        "users"
      );


    const user =
      await users.findOne({
        _id:
          session.userId,
        status:
          "ACTIVE"
      });


    if (!user) {
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


    if (
      nickname ===
      user.nickname
    ) {
      return jsonResponse(
        {
          success: false,
          message:
            "현재 닉네임과 같습니다."
        },
        400
      );
    }


    const nicknameLower =
      nickname.toLowerCase();


    const duplicate =
      await users.findOne({
        nicknameLower,
        _id: {
          $ne:
            user._id
        }
      });


    if (duplicate) {
      return jsonResponse(
        {
          success: false,
          message:
            "이미 사용 중인 닉네임입니다."
        },
        409
      );
    }


    const now =
      new Date();


    try {
      await users.updateOne(
        {
          _id:
            user._id,
          status:
            "ACTIVE"
        },
        {
          $set: {
            nickname,
            nicknameLower,
            updatedAt:
              now
          }
        }
      );

    } catch (error) {
      if (
        error &&
        error.code === 11000
      ) {
        return jsonResponse(
          {
            success: false,
            message:
              "이미 사용 중인 닉네임입니다."
          },
          409
        );
      }

      throw error;
    }


    // 작성 당시 닉네임을 별도로 저장하는 컬렉션도 함께 갱신한다.
    // 퀴즈 작성자/랭킹은 users 컬렉션을 실시간 참조하므로 별도 수정이 필요 없다.
    await Promise.all([
      db.collection("boardPosts")
        .updateMany(
          {
            authorId:
              user._id
          },
          {
            $set: {
              authorNickname:
                nickname
            }
          }
        ),

      db.collection("boardComments")
        .updateMany(
          {
            authorId:
              user._id
          },
          {
            $set: {
              authorNickname:
                nickname
            }
          }
        ),

      db.collection("communityMessages")
        .updateMany(
          {
            senderId:
              user._id
          },
          {
            $set: {
              senderNickname:
                nickname
            }
          }
        ),

      db.collection("communityNotices")
        .updateMany(
          {
            authorId:
              user._id
          },
          {
            $set: {
              authorNickname:
                nickname
            }
          }
        ),

      db.collection("communityPolls")
        .updateMany(
          {
            creatorId:
              user._id
          },
          {
            $set: {
              creatorNickname:
                nickname
            }
          }
        )
    ]);


    const updatedUser =
      {
        ...user,
        nickname,
        nicknameLower,
        updatedAt:
          now
      };


    return jsonResponse({
      success: true,
      message:
        "닉네임이 변경되었습니다.",
      user:
        getPublicUser(
          updatedUser
        )
    });


  } catch (error) {

    console.error(
      "UPDATE_NICKNAME_ERROR:",
      error
    );


    return jsonResponse(
      {
        success: false,
        message:
          "닉네임 변경 중 오류가 발생했습니다."
      },
      500
    );
  }
}


// =========================================================
// 로그아웃
// =========================================================

async function logout(
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

    await deleteSessionFromRequest(
      request
    );


    return jsonResponse(
      {
        success: true,
        message:
          "로그아웃되었습니다."
      },
      200,
      {
        "Set-Cookie":
          createClearSessionCookie()
      }
    );


  } catch (error) {

    console.error(
      "LOGOUT_ERROR:",
      error
    );


    return jsonResponse(
      {
        success: false,
        message:
          "로그아웃 중 오류가 발생했습니다."
      },
      500,
      {
        "Set-Cookie":
          createClearSessionCookie()
      }
    );
  }
}


const AUTH_ACTION_GUARDS = Object.freeze({
  signup: { methods: ["POST"], json: true, maxBodyBytes: 12 * 1024, rateLimit: { key: "auth:signup", limit: 5, windowMs: 60_000 } },
  login: { methods: ["POST"], json: true, maxBodyBytes: 12 * 1024, rateLimit: { key: "auth:login", limit: 10, windowMs: 60_000 } },
  me: { methods: ["GET"], rateLimit: { key: "auth:me", limit: 120, windowMs: 60_000 } },
  "my-stats": { methods: ["GET"], rateLimit: { key: "auth:my-stats", limit: 60, windowMs: 60_000 } },
  "update-nickname": { methods: ["POST"], json: true, maxBodyBytes: 4 * 1024, rateLimit: { key: "auth:update-nickname", limit: 6, windowMs: 60_000 } },
  logout: { methods: ["POST"], rateLimit: { key: "auth:logout", limit: 20, windowMs: 60_000 } }
});

// =========================================================
// 메인 라우터
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
      AUTH_ACTION_GUARDS[action];


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

      case "signup":

        return signup(
          request
        );


      case "login":

        return login(
          request
        );


      case "me":

        return me(
          request
        );


      case "my-stats":

        return myStats(
          request
        );


      case "update-nickname":

        return updateNickname(
          request
        );


      case "logout":

        return logout(
          request
        );


      default:

        return jsonResponse(
          {
            success: false,
            message:
              "존재하지 않는 인증 API입니다."
          },
          404
        );
    }
  }

};