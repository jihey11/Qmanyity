import {
  ObjectId
} from "mongodb";

import {
  getDatabase,
  getMongoClient
} from "../lib/mongodb.js";

import {
  getSessionFromRequest
} from "../lib/auth.js";

import {
  guardApiRequest,
  isAllowedEnum
} from "../lib/api.js";


// =========================================================
// 기본 설정
// =========================================================

const WRONG_LOCK_SECONDS =
  300;


// =========================================================
// 기본 카테고리
// =========================================================

const DEFAULT_CATEGORIES = [

  {
    id: "it-programming",
    name: "IT / 프로그래밍"
  },

  {
    id: "math",
    name: "수학"
  },

  {
    id: "science",
    name: "과학"
  },

  {
    id: "history",
    name: "역사"
  },

  {
    id: "music",
    name: "음악"
  },

  {
    id: "game",
    name: "게임"
  },

  {
    id: "sports",
    name: "스포츠"
  },

  {
    id: "general-knowledge",
    name: "상식"
  },

  {
    id: "etc",
    name: "기타"
  }

];


let defaultCategoriesReadyPromise =
  null;


// categories 컬렉션에 활성 카테고리가 하나도 없을 때만
// 기본 카테고리를 자동으로 생성한다.
// 기존 사용자가 이미 만든 카테고리가 있으면 그대로 유지한다.
async function ensureDefaultCategories(
  db
) {

  if (
    defaultCategoriesReadyPromise
  ) {

    return await
      defaultCategoriesReadyPromise;
  }


  defaultCategoriesReadyPromise =
    (async function() {

      const categories =
        db.collection(
          "categories"
        );


      const existingActive =
        await categories.findOne(
          {
            active: true
          },
          {
            projection: {
              _id: 1
            }
          }
        );


      // 이미 활성 카테고리가 있다면 기존 구성을 건드리지 않는다.
      if (
        existingActive
      ) {

        return;
      }


      const now =
        new Date();


      for (
        let index = 0;
        index <
          DEFAULT_CATEGORIES.length;
        index++
      ) {

        const item =
          DEFAULT_CATEGORIES[
            index
          ];


        await categories.updateOne(

          {
            _id:
              item.id
          },

          {
            $set: {

              name:
                item.name,

              active:
                true,

              isFixed:
                true,

              displayOrder:
                index + 1,

              updatedAt:
                now

            },

            $setOnInsert: {
              createdAt:
                now
            }
          },

          {
            upsert:
              true
          }

        );
      }


      console.log(
        "DEFAULT_CATEGORIES_READY"
      );

    })();


  try {

    await defaultCategoriesReadyPromise;

  } catch (error) {

    // 다음 요청에서 다시 시도할 수 있도록 캐시를 초기화한다.
    defaultCategoriesReadyPromise =
      null;

    throw error;
  }
}


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
// 첫 화면 부트스트랩용 사용자 공개 정보
// =========================================================

function getHomePublicUser(
  user
) {

  return {
    id: String(user._id),
    email: user.email || "",
    nickname: user.nickname || "사용자",
    point: Number(user.point || 0),
    totalScore: Number(user.totalScore || 0),
    character: user.character || "default",
    role: user.role || "USER"
  };
}


// =========================================================
// 정답 정규화
// =========================================================

function normalizeAnswer(
  value
) {

  return String(
    value || ""
  )
    .trim()
    .toLowerCase()
    .replace(
      /\s+/g,
      " "
    );
}


// =========================================================
// 난이도 점수
// =========================================================

function getReward(
  difficulty
) {

  if (
    difficulty ===
    "쉬움"
  ) {

    return 10;
  }


  if (
    difficulty ===
    "어려움"
  ) {

    return 30;
  }


  return 20;
}


// =========================================================
// 실제 정답 텍스트
// =========================================================

function getCorrectAnswer(
  quiz
) {

  if (
    quiz.questionType ===
    "SHORT_ANSWER"
  ) {

    return (
      quiz.solution
        ?.primaryAnswer ||
      ""
    );
  }


  const correctId =
    quiz.solution
      ?.correctOptionId;


  const option =
    (
      quiz.options ||
      []
    )
    .find(
      function(item) {

        return (
          item.id ===
          correctId
        );
      }
    );


  return (
    option?.text ||
    ""
  );
}


// =========================================================
// 로그인 검사
// =========================================================

async function requireSession(
  request
) {

  return await getSessionFromRequest(
    request
  );
}


// =========================================================
// 퀴즈 공통 입력 검사
// =========================================================

async function buildQuizData(
  db,
  body
) {

  // 새 DB이거나 활성 카테고리가 없는 경우
  // 퀴즈 저장 전에 기본 카테고리를 준비한다.
  await ensureDefaultCategories(
    db
  );


  const title =
    String(
      body.title || ""
    )
    .trim();


  const question =
    String(
      body.question || ""
    )
    .trim();


  const categoryId =
    String(
      body.categoryId || ""
    )
    .trim();


  const questionType =
    String(
      body.questionType || ""
    )
    .trim();


  const difficulty =
    String(
      body.difficulty || ""
    )
    .trim();


  const explanation =
    String(
      body.answerExplanation ||
      ""
    )
    .trim();


  if (
    title.length < 2 ||
    title.length > 100
  ) {

    return {
      error:
        "문제는 2~100자로 입력해주세요."
    };
  }


  // 상세 문제는 선택 입력이다.
  // 비어 있는 문자열은 허용하고, 작성한 경우에만 최대 길이를 검사한다.
  if (
    question.length > 1000
  ) {

    return {
      error:
        "상세 문제는 1000자 이하로 입력해주세요."
    };
  }


  if (
    explanation.length > 1000
  ) {

    return {
      error:
        "정답 해설은 1000자 이하로 입력해주세요."
    };
  }


  if (
    ![
      "MULTIPLE_CHOICE",
      "OX",
      "SHORT_ANSWER"
    ].includes(
      questionType
    )
  ) {

    return {
      error:
        "올바른 문제 유형을 선택해주세요."
    };
  }


  if (
    ![
      "쉬움",
      "보통",
      "어려움"
    ].includes(
      difficulty
    )
  ) {

    return {
      error:
        "올바른 난이도를 선택해주세요."
    };
  }


  if (
    !categoryId ||
    categoryId ===
    "all"
  ) {

    return {
      error:
        "카테고리를 선택해주세요."
    };
  }


  const category =
    await db
      .collection(
        "categories"
      )
      .findOne({

        _id:
          categoryId,

        active:
          true

      });


  if (!category) {

    return {
      error:
        "사용할 수 없는 카테고리입니다."
    };
  }


  // =======================================================
  // 부가 카테고리
  // =======================================================

  const rawTags =
    Array.isArray(
      body.tags
    )
      ? body.tags
      : [];


  const tags =
    [];


  for (
    const rawTag
    of rawTags
  ) {

    const tag =
      String(
        rawTag || ""
      )
      .trim()
      .replace(
        /^#+/,
        ""
      );


    if (!tag) {
      continue;
    }


    if (
      tag.length > 20
    ) {

      return {
        error:
          "부가 카테고리는 각각 20자 이하로 입력해주세요."
      };
    }


    if (
      !tags.some(
        function(item) {

          return (
            item.toLowerCase() ===
            tag.toLowerCase()
          );
        }
      )
    ) {

      tags.push(
        tag
      );
    }
  }


  if (
    tags.length > 5
  ) {

    return {
      error:
        "부가 카테고리는 최대 5개까지 등록할 수 있습니다."
    };
  }


  let options =
    [];


  let solution =
    {};


  // =======================================================
  // N지선다
  // =======================================================

  if (
    questionType ===
    "MULTIPLE_CHOICE"
  ) {

    const rawOptions =
      Array.isArray(
        body.options
      )
        ? body.options
        : [];


    if (
      rawOptions.length < 2 ||
      rawOptions.length > 10
    ) {

      return {
        error:
          "N지선다는 선택지를 2~10개 등록해주세요."
      };
    }


    options =
      rawOptions.map(
        function(
          value,
          index
        ) {

          return {

            id:
              "option_" +
              (
                index + 1
              ),

            text:
              String(
                value || ""
              )
              .trim(),

            order:
              index + 1

          };
        }
      );


    if (
      options.some(
        function(option) {

          return (
            !option.text ||
            option.text.length >
            200
          );
        }
      )
    ) {

      return {
        error:
          "모든 선택지를 입력해주세요."
      };
    }


    const correctIndex =
      Number(
        body.correctIndex
      );


    if (
      !Number.isInteger(
        correctIndex
      ) ||
      correctIndex < 0 ||
      correctIndex >=
      options.length
    ) {

      return {
        error:
          "정답 선택지를 지정해주세요."
      };
    }


    solution = {

      correctOptionId:
        options[
          correctIndex
        ].id,

      answerExplanation:
        explanation

    };
  }


  // =======================================================
  // OX
  // =======================================================

  if (
    questionType ===
    "OX"
  ) {

    const oxAnswer =
      String(
        body.oxAnswer || ""
      )
      .toUpperCase();


    if (
      oxAnswer !==
      "O" &&
      oxAnswer !==
      "X"
    ) {

      return {
        error:
          "OX 정답을 선택해주세요."
      };
    }


    options = [

      {
        id:
          "O",

        text:
          "O",

        order:
          1
      },

      {
        id:
          "X",

        text:
          "X",

        order:
          2
      }

    ];


    solution = {

      correctOptionId:
        oxAnswer,

      answerExplanation:
        explanation

    };
  }


  // =======================================================
  // 서술형
  // =======================================================

  if (
    questionType ===
    "SHORT_ANSWER"
  ) {

    const primaryAnswer =
      String(
        body.primaryAnswer ||
        ""
      )
      .trim();


    if (!primaryAnswer) {

      return {
        error:
          "기본 정답을 입력해주세요."
      };
    }


    if (
      primaryAnswer.length >
      100
    ) {

      return {
        error:
          "서술형 정답은 100자 이하로 입력해주세요."
      };
    }


    const primaryNormalized =
      normalizeAnswer(
        primaryAnswer
      );


    const rawAccepted =
      Array.isArray(
        body.acceptedAnswers
      )
        ? body.acceptedAnswers
        : [];


    const acceptedAnswers =
      [];


    for (
      const rawAnswer
      of rawAccepted
    ) {

      const text =
        String(
          rawAnswer || ""
        )
        .trim();


      if (!text) {
        continue;
      }


      if (
        text.length > 100
      ) {

        return {
          error:
            "추가 인정 정답은 각각 100자 이하로 입력해주세요."
        };
      }


      const normalized =
        normalizeAnswer(
          text
        );


      if (
        normalized ===
        primaryNormalized
      ) {

        continue;
      }


      if (
        !acceptedAnswers.some(
          function(item) {

            return (
              item.normalized ===
              normalized
            );
          }
        )
      ) {

        acceptedAnswers.push({

          text,

          normalized

        });
      }
    }


    if (
      acceptedAnswers.length >
      10
    ) {

      return {
        error:
          "추가 인정 정답은 최대 10개까지 등록할 수 있습니다."
      };
    }


    solution = {

      primaryAnswer,

      primaryNormalized,

      acceptedAnswers,

      answerExplanation:
        explanation

    };
  }


  return {

    data: {

      title,

      question,

      category,

      tags,

      difficulty,

      reward:
        getReward(
          difficulty
        ),

      questionType,

      options,

      solution

    }

  };
}


// =========================================================
// 홈 퀴즈
// =========================================================

function getSort(
  name
) {

  switch (name) {

    case "played":

      return {
        playCount: -1
      };


    case "wrong":

      return {
        wrongCount: -1
      };


    case "latest":

      return {
        createdAt: -1
      };


    default:

      return {
        likeCount: -1
      };
  }
}


async function home(
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
      await requireSession(
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


    const url =
      new URL(
        request.url
      );


    const sortName =
      url.searchParams.get(
        "sort"
      ) ||
      "popular";


    if (
      !isAllowedEnum(
        sortName,
        [
          "popular",
          "played",
          "wrong",
          "latest"
        ]
      )
    ) {
      return jsonResponse(
        {
          success: false,
          message: "지원하지 않는 퀴즈 정렬 방식입니다."
        },
        400
      );
    }


    // 첫 요청에서 기본 카테고리 생성 여부 확인 때문에 홈 응답이 늦어지지 않게
    // 카테고리 준비는 백그라운드에서 시작한다. 기존 DB에 카테고리가 있다면
    // 아래 실제 조회 결과를 그대로 사용하고, 완전히 빈 DB라면 정적 기본값을
    // 즉시 화면에 반환한다.
    void ensureDefaultCategories(
      db
    ).catch(
      function(error) {
        console.error(
          "DEFAULT_CATEGORIES_BACKGROUND_ERROR:",
          error
        );
      }
    );


    const userQuery =
      db
        .collection(
          "users"
        )
        .findOne(
          {
            _id:
              session.userId,
            status:
              "ACTIVE"
          },
          {
            projection: {
              email: 1,
              nickname: 1,
              point: 1,
              totalScore: 1,
              character: 1,
              role: 1
            }
          }
        );


    const categoriesQuery =
      db
        .collection(
          "categories"
        )
        .find({
          active:
            true
        })
        .sort({
          displayOrder:
            1
        })
        .project({
          name: 1,
          isFixed: 1
        })
        .toArray();


    // 작성자, 좋아요 여부, 현재 버전 풀이 상태를 MongoDB 내부 $lookup으로
    // 한 번에 묶어 가져온다. 이전 구조처럼 퀴즈 목록을 받은 뒤 다시 작성자,
    // 좋아요, 풀이 기록을 각각 요청하지 않아 DB 왕복 횟수가 크게 줄어든다.
    const quizzesQuery =
      db
        .collection(
          "quizzes"
        )
        .aggregate([

          {
            $match: {
              status:
                "ACTIVE"
            }
          },

          {
            $sort:
              getSort(
                sortName
              )
          },

          {
            $limit:
              30
          },

          {
            $project: {
              title: 1,
              categoryId: 1,
              categoryOriginalName: 1,
              tags: 1,
              difficulty: 1,
              reward: 1,
              questionType: 1,
              version: 1,
              writerId: 1,
              likeCount: 1,
              playCount: 1,
              wrongCount: 1,
              createdAt: 1
            }
          },

          {
            $lookup: {
              from:
                "users",
              localField:
                "writerId",
              foreignField:
                "_id",
              pipeline: [
                {
                  $project: {
                    nickname: 1
                  }
                },
                {
                  $limit: 1
                }
              ],
              as:
                "writerInfo"
            }
          },

          {
            $lookup: {
              from:
                "quizLikes",
              let: {
                currentQuizId:
                  "$_id"
              },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        {
                          $eq: [
                            "$quizId",
                            "$$currentQuizId"
                          ]
                        },
                        {
                          $eq: [
                            "$userId",
                            session.userId
                          ]
                        }
                      ]
                    }
                  }
                },
                {
                  $limit: 1
                },
                {
                  $project: {
                    _id: 1
                  }
                }
              ],
              as:
                "myLike"
            }
          },

          {
            $lookup: {
              from:
                "quizAttempts",
              let: {
                currentQuizId:
                  "$_id",
                currentVersion: {
                  $ifNull: [
                    "$version",
                    1
                  ]
                }
              },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        {
                          $eq: [
                            "$quizId",
                            "$$currentQuizId"
                          ]
                        },
                        {
                          $eq: [
                            "$userId",
                            session.userId
                          ]
                        },
                        {
                          $eq: [
                            {
                              $ifNull: [
                                "$quizVersion",
                                1
                              ]
                            },
                            "$$currentVersion"
                          ]
                        }
                      ]
                    }
                  }
                },
                {
                  $group: {
                    _id: null,
                    hasCorrect: {
                      $max: {
                        $cond: [
                          "$isCorrect",
                          1,
                          0
                        ]
                      }
                    },
                    lastWrongAt: {
                      $max: {
                        $cond: [
                          {
                            $eq: [
                              "$isCorrect",
                              false
                            ]
                          },
                          "$attemptedAt",
                          null
                        ]
                      }
                    }
                  }
                }
              ],
              as:
                "myAttemptState"
            }
          }

        ])
        .toArray();


    let [
      user,
      categories,
      quizzes
    ] = await Promise.all([
      userQuery,
      categoriesQuery,
      quizzesQuery
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


    if (!categories.length) {
      categories =
        DEFAULT_CATEGORIES.map(
          function(item) {
            return {
              _id:
                item.id,
              name:
                item.name,
              isFixed:
                true
            };
          }
        );
    }


    const categoryById =
      new Map();

    const activeNames =
      new Set();


    categories.forEach(
      function(category) {

        categoryById.set(
          String(
            category._id
          ),
          category.name
        );

        activeNames.add(
          category.name
        );
      }
    );


    const result =
      quizzes.map(
        function(quiz) {

          const id =
            String(
              quiz._id
            );


          const attemptState =
            quiz.myAttemptState?.[0] ||
            null;


          const solved =
            Boolean(
              Number(
                attemptState?.hasCorrect ||
                0
              )
            );


          let retryAfterSeconds =
            0;


          if (
            !solved &&
            attemptState?.lastWrongAt
          ) {

            const elapsed =
              Math.floor(
                (
                  Date.now() -
                  new Date(
                    attemptState.lastWrongAt
                  ).getTime()
                ) /
                1000
              );


            retryAfterSeconds =
              Math.max(
                0,
                WRONG_LOCK_SECONDS -
                elapsed
              );
          }


          let category =
            quiz.categoryOriginalName ||
            "기타";


          if (
            quiz.categoryId &&
            categoryById.has(
              String(
                quiz.categoryId
              )
            )
          ) {

            category =
              categoryById.get(
                String(
                  quiz.categoryId
                )
              );

          } else if (
            !activeNames.has(
              category
            )
          ) {

            category =
              "기타";
          }


          return {

            id,

            title:
              quiz.title || "",

            category,

            tags:
              quiz.tags || [],

            difficulty:
              quiz.difficulty ||
              "보통",

            point:
              Number(
                quiz.reward ||
                0
              ),

            questionType:
              quiz.questionType,

            writer:
              quiz.writerInfo?.[0]
                ?.nickname ||
              "알 수 없음",

            like:
              Number(
                quiz.likeCount ||
                0
              ),

            played:
              Number(
                quiz.playCount ||
                0
              ),

            wrong:
              Number(
                quiz.wrongCount ||
                0
              ),

            liked:
              Boolean(
                quiz.myLike?.length
              ),

            solved,

            retryAfterSeconds

          };
        }
      );


    return jsonResponse({

      success: true,

      // 첫 페이지 진입 시 /api/auth?action=me 요청을 별도로 하지 않아도 되도록
      // 홈 응답에 현재 로그인 사용자의 공개 정보도 함께 전달한다.
      user:
        getHomePublicUser(
          user
        ),

      categories: [

        {
          id:
            "all",

          name:
            "전체"
        },

        ...categories.map(
          function(category) {

            return {

              id:
                String(
                  category._id
                ),

              name:
                category.name,

              isFixed:
                Boolean(
                  category.isFixed
                )

            };
          }
        )

      ],

      quizzes:
        result

    });


  } catch (error) {

    console.error(
      "HOME_ERROR:",
      error
    );


    return jsonResponse(
      {
        success: false,
        message:
          "퀴즈 목록을 불러오지 못했습니다."
      },
      500
    );
  }
}


// =========================================================
// 퀴즈 만들기
// =========================================================

async function createQuiz(
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
      await requireSession(
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
          message:
            "사용자를 찾을 수 없습니다."
        },
        401
      );
    }


    const body =
      await request.json();


    const result =
      await buildQuizData(
        db,
        body
      );


    if (
      result.error
    ) {

      return jsonResponse(
        {
          success: false,
          message:
            result.error
        },
        400
      );
    }


    const data =
      result.data;


    const now =
      new Date();


    const inserted =
      await db
        .collection(
          "quizzes"
        )
        .insertOne({

          writerId:
            user._id,

          title:
            data.title,

          question:
            data.question,

          categoryId:
            data.category._id,

          categoryOriginalName:
            data.category.name,

          tags:
            data.tags,

          difficulty:
            data.difficulty,

          reward:
            data.reward,

          questionType:
            data.questionType,

          options:
            data.options,

          solution:
            data.solution,

          version:
            1,

          likeCount:
            0,

          playCount:
            0,

          wrongCount:
            0,

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
          "퀴즈가 등록되었습니다.",

        quiz: {

          id:
            inserted.insertedId
              .toString(),

          reward:
            data.reward
        }
      },
      201
    );


  } catch (error) {

    console.error(
      "CREATE_QUIZ_ERROR:",
      error
    );


    return jsonResponse(
      {
        success: false,
        message:
          "퀴즈 등록 중 오류가 발생했습니다."
      },
      500
    );
  }
}


// =========================================================
// 퀴즈 풀기용 데이터
// =========================================================

async function getQuiz(
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
      await requireSession(
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


    const url =
      new URL(
        request.url
      );


    const quizId =
      url.searchParams.get(
        "quizId"
      );


    if (
      !quizId ||
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


    const quiz =
      await db
        .collection(
          "quizzes"
        )
        .findOne({

          _id:
            new ObjectId(
              quizId
            ),

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


    const version =
      Number(
        quiz.version ||
        1
      );


    const attempts =
      db.collection(
        "quizAttempts"
      );


    const solved =
      await attempts.findOne({

        quizId:
          quiz._id,

        userId:
          session.userId,

        quizVersion:
          version,

        isCorrect:
          true

      });


    if (solved) {

      return jsonResponse({

        success:
          true,

        solved:
          true,

        locked:
          false,

        quiz: {

          id:
            quiz._id
              .toString(),

          title:
            quiz.title,

          question:
            quiz.question,

          category:
            quiz.categoryOriginalName ||
            "기타",

          difficulty:
            quiz.difficulty,

          point:
            Number(
              quiz.reward ||
              0
            ),

          questionType:
            quiz.questionType,

          options:
            (
              quiz.options ||
              []
            )
            .map(
              function(option) {

                return {

                  id:
                    option.id,

                  text:
                    option.text,

                  isAnswer:
                    option.id ===
                    quiz.solution
                      ?.correctOptionId

                };
              }
            ),

          correctAnswer:
            getCorrectAnswer(
              quiz
            ),

          answerExplanation:
            quiz.solution
              ?.answerExplanation ||
            ""

        }

      });
    }


    const lastWrong =
      await attempts.findOne(

        {

          quizId:
            quiz._id,

          userId:
            session.userId,

          quizVersion:
            version,

          isCorrect:
            false

        },

        {
          sort: {
            attemptedAt:
              -1
          }
        }

      );


    let retryAfterSeconds =
      0;


    if (
      lastWrong
        ?.attemptedAt
    ) {

      const elapsed =
        Math.floor(
          (
            Date.now() -
            new Date(
              lastWrong.attemptedAt
            ).getTime()
          ) /
          1000
        );


      retryAfterSeconds =
        Math.max(
          0,
          WRONG_LOCK_SECONDS -
          elapsed
        );
    }


    if (
      retryAfterSeconds > 0
    ) {

      return jsonResponse({

        success:
          true,

        solved:
          false,

        locked:
          true,

        retryAfterSeconds

      });
    }


    return jsonResponse({

      success:
        true,

      solved:
        false,

      locked:
        false,

      quiz: {

        id:
          quiz._id
            .toString(),

        title:
          quiz.title,

        question:
          quiz.question,

        category:
          quiz.categoryOriginalName ||
          "기타",

        difficulty:
          quiz.difficulty,

        point:
          Number(
            quiz.reward ||
            0
          ),

        questionType:
          quiz.questionType,

        options:
          (
            quiz.options ||
            []
          )
          .map(
            function(option) {

              return {

                id:
                  option.id,

                text:
                  option.text

              };
            }
          )

      }

    });


  } catch (error) {

    console.error(
      "GET_QUIZ_ERROR:",
      error
    );


    return jsonResponse(
      {
        success: false,
        message:
          "퀴즈를 불러오는 중 오류가 발생했습니다."
      },
      500
    );
  }
}


// =========================================================
// 답 제출
// =========================================================

async function submitAnswer(
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


  const loginSession =
    await requireSession(
      request
    );


  if (!loginSession) {

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


  let body;


  try {

    body =
      await request.json();

  } catch {

    return jsonResponse(
      {
        success: false,
        message:
          "올바른 요청 데이터가 아닙니다."
      },
      400
    );
  }


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


  try {

    const client =
      await getMongoClient();


    const db =
      client.db(
        "qmanyity"
      );


    const tx =
      client.startSession();


    let resultData =
      null;


    try {

      await tx.withTransaction(
        async function() {

          const quizzes =
            db.collection(
              "quizzes"
            );


          const users =
            db.collection(
              "users"
            );


          const attempts =
            db.collection(
              "quizAttempts"
            );


          const quiz =
            await quizzes.findOne(

              {
                _id:
                  new ObjectId(
                    quizId
                  ),

                status:
                  "ACTIVE"
              },

              {
                projection: {
                  version: 1,
                  questionType: 1,
                  difficulty: 1,
                  options: 1,
                  solution: 1
                },

                session:
                  tx
              }

            );


          if (!quiz) {

            resultData = {
              type:
                "error",

              status:
                404,

              message:
                "퀴즈를 찾을 수 없습니다."
            };

            return;
          }


          const user =
            await users.findOne(

              {
                _id:
                  loginSession.userId,

                status:
                  "ACTIVE"
              },

              {
                projection: {
                  point: 1,
                  totalScore: 1
                },

                session:
                  tx
              }

            );


          if (!user) {

            resultData = {
              type:
                "session"
            };

            return;
          }


          const version =
            Number(
              quiz.version ||
              1
            );


          // -------------------------------------------------
          // 현재 버전의 풀이 기록을 한 번의 MongoDB 조회로 요약한다.
          //
          // 기존에는 아래 정보를 각각 findOne()으로 조회했다.
          // - 이미 정답을 맞혔는지
          // - 가장 최근 오답 시간
          // - 이전 풀이가 있는지
          // - 이전 오답이 있는지
          //
          // 이 네 번의 왕복을 aggregate 한 번으로 줄여
          // Vercel ↔ MongoDB 네트워크 지연을 크게 줄인다.
          // -------------------------------------------------

          const attemptSummaryRows =
            await attempts
              .aggregate(
                [
                  {
                    $match: {
                      quizId:
                        quiz._id,
                      userId:
                        user._id,
                      quizVersion:
                        version
                    }
                  },
                  {
                    $group: {
                      _id:
                        null,

                      attemptCount: {
                        $sum:
                          1
                      },

                      hasCorrect: {
                        $max: {
                          $cond: [
                            {
                              $eq: [
                                "$isCorrect",
                                true
                              ]
                            },
                            1,
                            0
                          ]
                        }
                      },

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
                      },

                      lastWrongAt: {
                        $max: {
                          $cond: [
                            {
                              $eq: [
                                "$isCorrect",
                                false
                              ]
                            },
                            "$attemptedAt",
                            null
                          ]
                        }
                      }
                    }
                  }
                ],
                {
                  session:
                    tx
                }
              )
              .toArray();


          const attemptSummary =
            attemptSummaryRows[0] ||
            {
              attemptCount: 0,
              hasCorrect: 0,
              hasWrong: 0,
              lastWrongAt: null
            };


          const previousAttempt =
            Number(
              attemptSummary.attemptCount ||
              0
            ) > 0;


          const previousWrong =
            Number(
              attemptSummary.hasWrong ||
              0
            ) > 0;


          // 이미 현재 버전의 문제를 맞힌 사용자라면
          // 중복 포인트 지급 없이 즉시 정답 결과를 반환한다.
          if (
            Number(
              attemptSummary.hasCorrect ||
              0
            ) > 0
          ) {

            resultData = {

              type:
                "correct",

              reward:
                0,

              correctAnswer:
                getCorrectAnswer(
                  quiz
                ),

              explanation:
                quiz.solution
                  ?.answerExplanation ||
                "",

              user: {

                point:
                  Number(
                    user.point ||
                    0
                  ),

                totalScore:
                  Number(
                    user.totalScore ||
                    0
                  )

              }

            };

            return;
          }


          // 최근 오답이 있다면 5분 재도전 제한을 계산한다.
          if (
            attemptSummary.lastWrongAt
          ) {

            const elapsed =
              Math.floor(
                (
                  Date.now() -
                  new Date(
                    attemptSummary.lastWrongAt
                  ).getTime()
                ) /
                1000
              );


            const retry =
              Math.max(
                0,
                WRONG_LOCK_SECONDS -
                elapsed
              );


            if (
              retry > 0
            ) {

              resultData = {

                type:
                  "locked",

                retryAfterSeconds:
                  retry

              };

              return;
            }
          }


          let correct =
            false;


          // 객관식/OX
          if (
            quiz.questionType ===
              "MULTIPLE_CHOICE" ||
            quiz.questionType ===
              "OX"
          ) {

            correct =
              String(
                body.answer ||
                ""
              ) ===
              String(
                quiz.solution
                  ?.correctOptionId ||
                ""
              );
          }


          // 서술형
          if (
            quiz.questionType ===
            "SHORT_ANSWER"
          ) {

            const normalized =
              normalizeAnswer(
                body.answer
              );


            const accepted = [

              quiz.solution
                ?.primaryNormalized,

              ...(
                quiz.solution
                  ?.acceptedAnswers ||
                []
              )
              .map(
                answer =>
                  answer.normalized
              )

            ]
            .filter(Boolean);


            correct =
              accepted.includes(
                normalized
              );
          }


          const now =
            new Date();


          // 오답
          if (!correct) {

            await attempts.insertOne(

              {

                quizId:
                  quiz._id,

                userId:
                  user._id,

                quizVersion:
                  version,

                isCorrect:
                  false,

                attemptedAt:
                  now

              },

              {
                session:
                  tx
              }

            );


            const inc =
              {};


            if (
              !previousAttempt
            ) {

              inc.playCount =
                1;
            }


            if (
              !previousWrong
            ) {

              inc.wrongCount =
                1;
            }


            if (
              Object.keys(
                inc
              ).length
            ) {

              await quizzes.updateOne(

                {
                  _id:
                    quiz._id
                },

                {
                  $inc:
                    inc
                },

                {
                  session:
                    tx
                }

              );
            }


            resultData = {

              type:
                "wrong",

              retryAfterSeconds:
                WRONG_LOCK_SECONDS

            };

            return;
          }


          // 정답
          const reward =
            getReward(
              quiz.difficulty
            );


          await attempts.insertOne(

            {

              quizId:
                quiz._id,

              userId:
                user._id,

              quizVersion:
                version,

              isCorrect:
                true,

              attemptedAt:
                now

            },

            {
              session:
                tx
            }

          );


          await users.updateOne(

            {
              _id:
                user._id
            },

            {

              $inc: {

                point:
                  reward,

                totalScore:
                  reward

              },

              $set: {
                updatedAt:
                  now
              }

            },

            {
              session:
                tx
            }

          );


          if (
            !previousAttempt
          ) {

            await quizzes.updateOne(

              {
                _id:
                  quiz._id
              },

              {
                $inc: {
                  playCount:
                    1
                }
              },

              {
                session:
                  tx
              }

            );
          }


          resultData = {

            type:
              "correct",

            reward,

            correctAnswer:
              getCorrectAnswer(
                quiz
              ),

            explanation:
              quiz.solution
                ?.answerExplanation ||
              "",

            user: {

              point:
                Number(
                  user.point ||
                  0
                ) +
                reward,

              totalScore:
                Number(
                  user.totalScore ||
                  0
                ) +
                reward

            }

          };

        }
      );


    } finally {

      await tx.endSession();
    }


    if (
      resultData?.type ===
      "session"
    ) {

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


    if (
      resultData?.type ===
      "error"
    ) {

      return jsonResponse(
        {
          success: false,
          message:
            resultData.message
        },
        resultData.status
      );
    }


    if (
      resultData?.type ===
      "locked"
    ) {

      return jsonResponse({

        success:
          true,

        correct:
          false,

        locked:
          true,

        retryAfterSeconds:
          resultData
            .retryAfterSeconds

      });
    }


    if (
      resultData?.type ===
      "wrong"
    ) {

      return jsonResponse({

        success:
          true,

        correct:
          false,

        locked:
          false,

        retryAfterSeconds:
          resultData
            .retryAfterSeconds

      });
    }


    return jsonResponse({

      success:
        true,

      correct:
        true,

      locked:
        false,

      reward:
        resultData?.reward ||
        0,

      correctAnswer:
        resultData
          ?.correctAnswer ||
        "",

      answerExplanation:
        resultData
          ?.explanation ||
        "",

      user:
        resultData?.user

    });


  } catch (error) {

    console.error(
      "SUBMIT_ANSWER_ERROR:",
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
            "이미 처리된 정답입니다."
        },
        409
      );
    }


    return jsonResponse(
      {
        success: false,
        message:
          "답안을 처리하는 중 오류가 발생했습니다."
      },
      500
    );
  }
}


// =========================================================
// 내가 만든 퀴즈 목록
// =========================================================

async function myQuizzes(
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
      await requireSession(
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


    const quizzes =
      await db
        .collection(
          "quizzes"
        )
        .find({

          writerId:
            session.userId,

          status:
            "ACTIVE"

        })
        .sort({
          createdAt:
            -1
        })
        .project({

          title: 1,

          categoryOriginalName: 1,

          difficulty: 1,

          reward: 1,

          questionType: 1,

          version: 1,

          likeCount: 1,

          playCount: 1,

          wrongCount: 1,

          tags: 1

        })
        .toArray();


    return jsonResponse({

      success: true,

      quizzes:
        quizzes.map(
          function(quiz) {

            return {

              id:
                quiz._id
                  .toString(),

              title:
                quiz.title,

              category:
                quiz.categoryOriginalName ||
                "기타",

              difficulty:
                quiz.difficulty,

              point:
                Number(
                  quiz.reward ||
                  0
                ),

              questionType:
                quiz.questionType,

              version:
                Number(
                  quiz.version ||
                  1
                ),

              like:
                Number(
                  quiz.likeCount ||
                  0
                ),

              played:
                Number(
                  quiz.playCount ||
                  0
                ),

              wrong:
                Number(
                  quiz.wrongCount ||
                  0
                ),

              tags:
                quiz.tags ||
                []

            };
          }
        )

    });


  } catch (error) {

    console.error(
      "MY_QUIZZES_ERROR:",
      error
    );


    return jsonResponse(
      {
        success: false,
        message:
          "내 퀴즈를 불러오지 못했습니다."
      },
      500
    );
  }
}


// =========================================================
// 내 퀴즈 삭제
// =========================================================

async function deleteQuiz(
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
      await requireSession(
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


    const now =
      new Date();


    const result =
      await db
        .collection(
          "quizzes"
        )
        .updateOne(

          {

            _id:
              new ObjectId(
                quizId
              ),

            writerId:
              session.userId,

            status:
              "ACTIVE"

          },

          {
            $set: {

              status:
                "DELETED",

              deletedAt:
                now,

              updatedAt:
                now

            }
          }

        );


    if (
      result.matchedCount ===
      0
    ) {

      return jsonResponse(
        {
          success: false,
          message:
            "삭제할 수 없는 퀴즈입니다."
        },
        404
      );
    }


    return jsonResponse({

      success: true,

      message:
        "퀴즈가 삭제되었습니다."

    });


  } catch (error) {

    console.error(
      "DELETE_QUIZ_ERROR:",
      error
    );


    return jsonResponse(
      {
        success: false,
        message:
          "퀴즈 삭제 중 오류가 발생했습니다."
      },
      500
    );
  }
}


// =========================================================
// 수정용 퀴즈 가져오기
// =========================================================

async function getMyQuiz(
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
      await requireSession(
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


    const url =
      new URL(
        request.url
      );


    const quizId =
      url.searchParams.get(
        "quizId"
      );


    if (
      !quizId ||
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


    const quiz =
      await db
        .collection(
          "quizzes"
        )
        .findOne({

          _id:
            new ObjectId(
              quizId
            ),

          writerId:
            session.userId,

          status:
            "ACTIVE"

        });


    if (!quiz) {

      return jsonResponse(
        {
          success: false,
          message:
            "수정할 수 없는 퀴즈입니다."
        },
        404
      );
    }


    const result = {

      id:
        quiz._id
          .toString(),

      title:
        quiz.title,

      question:
        quiz.question,

      categoryId:
        String(
          quiz.categoryId ||
          ""
        ),

      categoryOriginalName:
        quiz.categoryOriginalName ||
        "기타",

      tags:
        quiz.tags ||
        [],

      difficulty:
        quiz.difficulty,

      questionType:
        quiz.questionType,

      version:
        Number(
          quiz.version ||
          1
        ),

      answerExplanation:
        quiz.solution
          ?.answerExplanation ||
        "",

      options:
        [],

      correctIndex:
        0,

      oxAnswer:
        "O",

      primaryAnswer:
        "",

      acceptedAnswers:
        []

    };


    if (
      quiz.questionType ===
      "MULTIPLE_CHOICE"
    ) {

      result.options =
        (
          quiz.options ||
          []
        )
        .map(
          option => ({

            id:
              option.id,

            text:
              option.text

          })
        );


      const index =
        result.options.findIndex(
          option =>
            option.id ===
            quiz.solution
              ?.correctOptionId
        );


      result.correctIndex =
        index >= 0
          ? index
          : 0;
    }


    if (
      quiz.questionType ===
      "OX"
    ) {

      result.oxAnswer =
        quiz.solution
          ?.correctOptionId ===
          "X"
            ? "X"
            : "O";
    }


    if (
      quiz.questionType ===
      "SHORT_ANSWER"
    ) {

      result.primaryAnswer =
        quiz.solution
          ?.primaryAnswer ||
        "";


      result.acceptedAnswers =
        (
          quiz.solution
            ?.acceptedAnswers ||
          []
        )
        .map(
          answer =>
            answer.text
        )
        .filter(Boolean);
    }


    return jsonResponse({

      success:
        true,

      quiz:
        result

    });


  } catch (error) {

    console.error(
      "GET_MY_QUIZ_ERROR:",
      error
    );


    return jsonResponse(
      {
        success: false,
        message:
          "퀴즈 정보를 불러오지 못했습니다."
      },
      500
    );
  }
}


// =========================================================
// 퀴즈 수정
// =========================================================

async function updateQuiz(
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
      await requireSession(
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


    const oldQuiz =
      await db
        .collection(
          "quizzes"
        )
        .findOne({

          _id:
            new ObjectId(
              quizId
            ),

          writerId:
            session.userId,

          status:
            "ACTIVE"

        });


    if (!oldQuiz) {

      return jsonResponse(
        {
          success: false,
          message:
            "수정할 수 없는 퀴즈입니다."
        },
        403
      );
    }


    const checked =
      await buildQuizData(
        db,
        body
      );


    if (
      checked.error
    ) {

      return jsonResponse(
        {
          success: false,
          message:
            checked.error
        },
        400
      );
    }


    const data =
      checked.data;


    const now =
      new Date();


    await db
      .collection(
        "quizzes"
      )
      .updateOne(

        {
          _id:
            oldQuiz._id
        },

        {

          $set: {

            title:
              data.title,

            question:
              data.question,

            categoryId:
              data.category._id,

            categoryOriginalName:
              data.category.name,

            tags:
              data.tags,

            difficulty:
              data.difficulty,

            reward:
              data.reward,

            questionType:
              data.questionType,

            options:
              data.options,

            solution:
              data.solution,

            updatedAt:
              now

          },

          $inc: {
            version:
              1
          }

        }

      );


    return jsonResponse({

      success:
        true,

      message:
        "퀴즈가 수정되었습니다.",

      quiz: {

        id:
          quizId,

        version:
          Number(
            oldQuiz.version ||
            1
          ) +
          1

      }

    });


  } catch (error) {

    console.error(
      "UPDATE_QUIZ_ERROR:",
      error
    );


    return jsonResponse(
      {
        success: false,
        message:
          "퀴즈 수정 중 오류가 발생했습니다."
      },
      500
    );
  }
}


const QUIZ_ACTION_GUARDS = Object.freeze({
  home: { methods: ["GET"], rateLimit: { key: "quiz:home", limit: 90, windowMs: 60_000 } },
  "create-quiz": { methods: ["POST"], json: true, maxBodyBytes: 64 * 1024, rateLimit: { key: "quiz:create", limit: 10, windowMs: 60_000 } },
  "get-quiz": { methods: ["GET"], rateLimit: { key: "quiz:get", limit: 120, windowMs: 60_000 } },
  "submit-answer": { methods: ["POST"], json: true, maxBodyBytes: 24 * 1024, rateLimit: { key: "quiz:submit", limit: 40, windowMs: 60_000 } },
  "my-quizzes": { methods: ["GET"], rateLimit: { key: "quiz:mine", limit: 60, windowMs: 60_000 } },
  "delete-quiz": { methods: ["POST"], json: true, maxBodyBytes: 8 * 1024, rateLimit: { key: "quiz:delete", limit: 20, windowMs: 60_000 } },
  "get-my-quiz": { methods: ["GET"], rateLimit: { key: "quiz:get-mine", limit: 60, windowMs: 60_000 } },
  "update-quiz": { methods: ["POST"], json: true, maxBodyBytes: 64 * 1024, rateLimit: { key: "quiz:update", limit: 20, windowMs: 60_000 } }
});

// =========================================================
// 메인 Router
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
      QUIZ_ACTION_GUARDS[action];


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

      case "home":

        return home(
          request
        );


      case "create-quiz":

        return createQuiz(
          request
        );


      case "get-quiz":

        return getQuiz(
          request
        );


      case "submit-answer":

        return submitAnswer(
          request
        );


      case "my-quizzes":

        return myQuizzes(
          request
        );


      case "delete-quiz":

        return deleteQuiz(
          request
        );


      case "get-my-quiz":

        return getMyQuiz(
          request
        );


      case "update-quiz":

        return updateQuiz(
          request
        );


      default:

        return jsonResponse(
          {
            success: false,
            message:
              "존재하지 않는 퀴즈 API입니다."
          },
          404
        );
    }
  }

};