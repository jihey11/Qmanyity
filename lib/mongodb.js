import {
  MongoClient
} from "mongodb";


import {
  BOARD_COLLECTIONS
} from "./board.js";


const uri =
  process.env.MONGODB_URI;


if (!uri) {

  throw new Error(
    "MONGODB_URI 환경변수가 설정되지 않았습니다."
  );
}


const globalForMongo =
  globalThis;


if (
  !globalForMongo.mongoClientPromise
) {

  const client =
    new MongoClient(uri);


  globalForMongo.mongoClientPromise =
    client.connect();
}


const clientPromise =
  globalForMongo.mongoClientPromise;


const DATABASE_INDEX_VERSION =
  "qmanyity-indexes-v6-speed";


// =========================================================
// 인덱스 비교용 함수
// =========================================================

function isSameKeyPattern(
  firstKey,
  secondKey
) {

  const firstEntries =
    Object.entries(
      firstKey || {}
    );

  const secondEntries =
    Object.entries(
      secondKey || {}
    );


  if (
    firstEntries.length !==
    secondEntries.length
  ) {

    return false;
  }


  for (
    let index = 0;
    index < firstEntries.length;
    index += 1
  ) {

    const [
      firstField,
      firstDirection
    ] = firstEntries[index];

    const [
      secondField,
      secondDirection
    ] = secondEntries[index];


    if (
      firstField !== secondField ||
      firstDirection !== secondDirection
    ) {

      return false;
    }
  }


  return true;
}


function normalizeObject(
  value
) {

  if (
    Array.isArray(value)
  ) {

    return value.map(
      normalizeObject
    );
  }


  if (
    value !== null &&
    typeof value === "object"
  ) {

    const result = {};


    Object.keys(value)
      .sort()
      .forEach(
        function(key) {

          result[key] =
            normalizeObject(
              value[key]
            );
        }
      );


    return result;
  }


  return value;
}


function isSameObject(
  firstValue,
  secondValue
) {

  return (
    JSON.stringify(
      normalizeObject(
        firstValue
      )
    ) ===
    JSON.stringify(
      normalizeObject(
        secondValue
      )
    )
  );
}


function isCompatibleIndex(
  existingIndex,
  wantedOptions
) {

  // UNIQUE가 필요한 경우 기존 인덱스도 UNIQUE여야 한다.
  if (
    wantedOptions.unique === true &&
    existingIndex.unique !== true
  ) {

    return false;
  }


  // TTL 인덱스는 expireAfterSeconds 값까지 같아야 한다.
  if (
    Object.prototype.hasOwnProperty.call(
      wantedOptions,
      "expireAfterSeconds"
    )
  ) {

    if (
      Number(
        existingIndex.expireAfterSeconds
      ) !==
      Number(
        wantedOptions.expireAfterSeconds
      )
    ) {

      return false;
    }
  }


  // 우리가 partial unique 인덱스를 원할 때:
  // 1) 기존 인덱스에도 같은 partial 조건이 있으면 호환된다.
  // 2) 기존 인덱스가 partial이 아닌 전체 UNIQUE라면
  //    더 강한 제약이므로 그대로 사용해도 된다.
  if (
    wantedOptions.partialFilterExpression
  ) {

    if (
      existingIndex.partialFilterExpression &&
      !isSameObject(
        existingIndex.partialFilterExpression,
        wantedOptions.partialFilterExpression
      )
    ) {

      return false;
    }
  }


  return true;
}


async function findCompatibleIndex(
  collection,
  wantedKey,
  wantedOptions
) {

  let indexes;


  try {

    indexes =
      await collection.indexes();

  } catch (error) {

    // 새 기능을 처음 배포한 직후에는 해당 컬렉션이 아직
    // 존재하지 않을 수 있다. MongoDB의 collection.indexes()는
    // 존재하지 않는 컬렉션에 대해 NamespaceNotFound(code 26)를
    // 발생시키므로, 이 경우에는 "기존 인덱스 없음"으로 처리한다.
    // 이후 ensureIndex()의 createIndex()가 컬렉션과 인덱스를
    // 정상적으로 생성한다.
    const message =
      String(
        error?.message ||
        ""
      );


    const isNamespaceNotFound =
      Number(
        error?.code
      ) === 26 ||
      error?.codeName ===
        "NamespaceNotFound" ||
      message.includes(
        "NamespaceNotFound"
      ) ||
      message.includes(
        "ns does not exist"
      );


    if (
      isNamespaceNotFound
    ) {

      return null;
    }


    throw error;
  }


  for (
    const existingIndex of indexes
  ) {

    if (
      !isSameKeyPattern(
        existingIndex.key,
        wantedKey
      )
    ) {

      continue;
    }


    if (
      isCompatibleIndex(
        existingIndex,
        wantedOptions
      )
    ) {

      return existingIndex;
    }
  }


  return null;
}


async function ensureIndex(
  collection,
  wantedKey,
  wantedOptions
) {

  // 먼저 같은 역할의 기존 인덱스가 있는지 확인한다.
  // 인덱스 이름은 달라도 key와 중요한 옵션이 같으면 재사용한다.
  const existingIndex =
    await findCompatibleIndex(
      collection,
      wantedKey,
      wantedOptions
    );


  if (
    existingIndex
  ) {

    console.log(
      "MONGODB_INDEX_REUSED:",
      collection.collectionName,
      existingIndex.name
    );


    return existingIndex.name;
  }


  try {

    return await collection.createIndex(
      wantedKey,
      wantedOptions
    );

  } catch(error) {

    // Vercel의 여러 서버리스 인스턴스가 거의 동시에 실행되거나,
    // 이미 같은 인덱스가 다른 이름으로 존재하는 경우를 처리한다.
    const message =
      String(
        error?.message || ""
      );

    const canRetryByCheckingExistingIndex =
      error?.codeName === "IndexOptionsConflict" ||
      error?.codeName === "IndexKeySpecsConflict" ||
      message.includes(
        "Index already exists with a different name"
      ) ||
      message.includes(
        "already exists with a different name"
      );


    if (
      canRetryByCheckingExistingIndex
    ) {

      const indexAfterError =
        await findCompatibleIndex(
          collection,
          wantedKey,
          wantedOptions
        );


      if (
        indexAfterError
      ) {

        console.log(
          "MONGODB_INDEX_REUSED_AFTER_CONFLICT:",
          collection.collectionName,
          indexAfterError.name
        );


        return indexAfterError.name;
      }
    }


    throw error;
  }
}


// =========================================================
// MongoDB 인덱스 생성
// =========================================================


async function ensureDatabaseIndexes(
  db
) {

  if (
    !globalForMongo.mongoIndexesPromise
  ) {

    globalForMongo.mongoIndexesPromise =
      (async function() {

        const indexMetaCollection =
          db.collection(
            "appMeta"
          );


        const completedIndexSetup =
          await indexMetaCollection.findOne({
            _id:
              DATABASE_INDEX_VERSION,
            completed:
              true
          });


        if (
          completedIndexSetup
        ) {

          console.log(
            "MONGODB_INDEXES_ALREADY_READY"
          );

          return;
        }


        // -------------------------------------------------
        // users
        // 이메일 / 닉네임 중복 가입 방지
        // -------------------------------------------------

        await ensureIndex(
          db.collection(
            "users"
          ),
          {
            emailLower: 1
          },
          {
            name:
              "uniq_users_emailLower",

            unique:
              true,

            partialFilterExpression: {
              emailLower: {
                $type:
                  "string"
              }
            }
          }
        );


        await ensureIndex(
          db.collection(
            "users"
          ),
          {
            nicknameLower: 1
          },
          {
            name:
              "uniq_users_nicknameLower",

            unique:
              true,

            partialFilterExpression: {
              nicknameLower: {
                $type:
                  "string"
              }
            }
          }
        );


        // -------------------------------------------------
        // sessions
        // 세션 토큰 중복 방지 + 만료 세션 자동 삭제
        // -------------------------------------------------

        await ensureIndex(
          db.collection(
            "sessions"
          ),
          {
            tokenHash: 1
          },
          {
            name:
              "uniq_sessions_tokenHash",

            unique:
              true,

            partialFilterExpression: {
              tokenHash: {
                $type:
                  "string"
              }
            }
          }
        );


        await ensureIndex(
          db.collection(
            "sessions"
          ),
          {
            expiresAt: 1
          },
          {
            name:
              "ttl_sessions_expiresAt",

            // expiresAt 시간이 지나면 MongoDB가
            // 만료된 세션 문서를 자동으로 삭제한다.
            expireAfterSeconds:
              0
          }
        );


        // -------------------------------------------------
        // 홈 / 랭킹 성능 인덱스
        // -------------------------------------------------

        await ensureIndex(
          db.collection("categories"),
          {
            active: 1,
            displayOrder: 1
          },
          {
            name:
              "idx_categories_active_displayOrder"
          }
        );


        await ensureIndex(
          db.collection("quizzes"),
          {
            status: 1,
            likeCount: -1
          },
          {
            name:
              "idx_quizzes_status_likeCount"
          }
        );

        await ensureIndex(
          db.collection("quizzes"),
          {
            status: 1,
            playCount: -1
          },
          {
            name:
              "idx_quizzes_status_playCount"
          }
        );

        await ensureIndex(
          db.collection("quizzes"),
          {
            status: 1,
            wrongCount: -1
          },
          {
            name:
              "idx_quizzes_status_wrongCount"
          }
        );

        await ensureIndex(
          db.collection("quizzes"),
          {
            status: 1,
            createdAt: -1
          },
          {
            name:
              "idx_quizzes_status_createdAt"
          }
        );


        await ensureIndex(
          db.collection("users"),
          {
            status: 1,
            totalScore: -1,
            createdAt: 1
          },
          {
            name:
              "idx_users_status_totalScore_createdAt"
          }
        );


        // -------------------------------------------------
        // quizLikes
        // 한 사용자가 같은 퀴즈에 중복 좋아요 데이터 생성 방지
        // -------------------------------------------------

        await ensureIndex(
          db.collection(
            "quizLikes"
          ),
          {
            quizId: 1,
            userId: 1
          },
          {
            name:
              "uniq_quizLikes_quizId_userId",

            unique:
              true,

            partialFilterExpression: {
              quizId: {
                $type:
                  "objectId"
              },

              userId: {
                $type:
                  "objectId"
              }
            }
          }
        );


        // -------------------------------------------------
        // communityRoomMembers
        // 같은 사용자가 같은 채팅방에 중복 참여 데이터 생성 방지
        // -------------------------------------------------

        await ensureIndex(
          db.collection(
            "communityRoomMembers"
          ),
          {
            roomId: 1,
            userId: 1
          },
          {
            name:
              "uniq_communityRoomMembers_roomId_userId",

            unique:
              true,

            partialFilterExpression: {
              roomId: {
                $type:
                  "string"
              },

              userId: {
                $type:
                  "objectId"
              }
            }
          }
        );


        // -------------------------------------------------
        // communityPollVotes
        // 한 사용자가 한 투표에 하나의 투표 기록만 가지도록 제한
        // 선택지를 바꾸는 경우 기존 문서를 update한다.
        // -------------------------------------------------

        await ensureIndex(
          db.collection(
            "communityPollVotes"
          ),
          {
            pollId: 1,
            userId: 1
          },
          {
            name:
              "uniq_communityPollVotes_pollId_userId",

            unique:
              true,

            partialFilterExpression: {
              pollId: {
                $type:
                  "objectId"
              },

              userId: {
                $type:
                  "objectId"
              }
            }
          }
        );


        // -------------------------------------------------
        // quizAttempts
        // 답 제출 시 현재 퀴즈 버전의 풀이 기록을 빠르게 요약한다.
        // -------------------------------------------------

        await ensureIndex(
          db.collection(
            "quizAttempts"
          ),
          {
            quizId: 1,
            userId: 1,
            quizVersion: 1,
            attemptedAt: -1
          },
          {
            name:
              "idx_quizAttempts_quiz_user_version_attemptedAt"
          }
        );


        // 마이페이지 통계:
        // 사용자별 전체 풀이 문제 / 오답 문제 집계를 빠르게 한다.
        await ensureIndex(
          db.collection(
            "quizAttempts"
          ),
          {
            userId: 1,
            isCorrect: 1,
            quizId: 1
          },
          {
            name:
              "idx_quizAttempts_user_correct_quiz"
          }
        );


        // 본인이 현재 등록한 퀴즈 수 및 내 퀴즈 조회를 빠르게 한다.
        await ensureIndex(
          db.collection(
            "quizzes"
          ),
          {
            writerId: 1,
            status: 1,
            createdAt: -1
          },
          {
            name:
              "idx_quizzes_writer_status_createdAt"
          }
        );


        // -------------------------------------------------
        // 전체 커뮤니티 조회 성능용 인덱스
        // 첫 피드 로딩과 이후 증분(createdAt / updatedAt) 조회를 빠르게 한다.
        // -------------------------------------------------

        await ensureIndex(
          db.collection(
            "communityMessages"
          ),
          {
            roomId: 1,
            createdAt: -1
          },
          {
            name:
              "idx_communityMessages_roomId_createdAt"
          }
        );


        await ensureIndex(
          db.collection(
            "communityMessages"
          ),
          {
            roomId: 1,
            updatedAt: 1
          },
          {
            name:
              "idx_communityMessages_roomId_updatedAt"
          }
        );


        await ensureIndex(
          db.collection(
            "communityNotices"
          ),
          {
            roomId: 1,
            status: 1,
            createdAt: -1
          },
          {
            name:
              "idx_communityNotices_room_status_createdAt"
          }
        );


        await ensureIndex(
          db.collection(
            "communityPolls"
          ),
          {
            roomId: 1,
            status: 1,
            createdAt: -1
          },
          {
            name:
              "idx_communityPolls_room_status_createdAt"
          }
        );


        // -------------------------------------------------
        // 게시판 DB 구조
        // -------------------------------------------------
        
        // 최신 게시물 목록
        await ensureIndex(
          db.collection(
            BOARD_COLLECTIONS.POSTS
          ),
          {
            status: 1,
            createdAt: -1
          },
          {
            name:
              "idx_boardPosts_status_createdAt"
          }
        );


        // 특정 사용자가 작성한 게시물 조회
        await ensureIndex(
          db.collection(
            BOARD_COLLECTIONS.POSTS
          ),
          {
            authorId: 1,
            status: 1,
            createdAt: -1
          },
          {
            name:
              "idx_boardPosts_author_status_createdAt"
          }
        );


        // 부가 카테고리 필터 + 최신순
        await ensureIndex(
          db.collection(
            BOARD_COLLECTIONS.POSTS
          ),
          {
            additionalCategory: 1,
            status: 1,
            createdAt: -1
          },
          {
            name:
              "idx_boardPosts_category_status_createdAt"
          }
        );


        // 인기순(좋아요) 정렬
        await ensureIndex(
          db.collection(
            BOARD_COLLECTIONS.POSTS
          ),
          {
            status: 1,
            likeCount: -1,
            createdAt: -1
          },
          {
            name:
              "idx_boardPosts_status_likeCount_createdAt"
          }
        );


        // 댓글순 정렬
        await ensureIndex(
          db.collection(
            BOARD_COLLECTIONS.POSTS
          ),
          {
            status: 1,
            commentCount: -1,
            createdAt: -1
          },
          {
            name:
              "idx_boardPosts_status_commentCount_createdAt"
          }
        );


        // 조회순 정렬
        await ensureIndex(
          db.collection(
            BOARD_COLLECTIONS.POSTS
          ),
          {
            status: 1,
            viewCount: -1,
            createdAt: -1
          },
          {
            name:
              "idx_boardPosts_status_viewCount_createdAt"
          }
        );


        // 특정 퀴즈가 첨부된 게시물 조회용
        await ensureIndex(
          db.collection(
            BOARD_COLLECTIONS.POSTS
          ),
          {
            quizId: 1,
            status: 1,
            createdAt: -1
          },
          {
            name:
              "idx_boardPosts_quiz_status_createdAt"
          }
        );


        // 게시물 댓글 목록
        await ensureIndex(
          db.collection(
            BOARD_COLLECTIONS.COMMENTS
          ),
          {
            postId: 1,
            status: 1,
            createdAt: 1
          },
          {
            name:
              "idx_boardComments_post_status_createdAt"
          }
        );


        // 사용자가 작성한 댓글 조회
        await ensureIndex(
          db.collection(
            BOARD_COLLECTIONS.COMMENTS
          ),
          {
            authorId: 1,
            status: 1,
            createdAt: -1
          },
          {
            name:
              "idx_boardComments_author_status_createdAt"
          }
        );


        // 한 사용자가 같은 게시물에 하나의 좋아요만 가질 수 있다.
        await ensureIndex(
          db.collection(
            BOARD_COLLECTIONS.LIKES
          ),
          {
            postId: 1,
            userId: 1
          },
          {
            name:
              "uniq_boardLikes_postId_userId",

            unique:
              true,

            partialFilterExpression: {
              postId: {
                $type:
                  "objectId"
              },

              userId: {
                $type:
                  "objectId"
              }
            }
          }
        );


        // 사용자가 좋아요한 게시물을 최신순으로 찾을 때 사용한다.
        await ensureIndex(
          db.collection(
            BOARD_COLLECTIONS.LIKES
          ),
          {
            userId: 1,
            createdAt: -1
          },
          {
            name:
              "idx_boardLikes_userId_createdAt"
          }
        );


        await indexMetaCollection.updateOne(
          {
            _id:
              DATABASE_INDEX_VERSION
          },
          {
            $set: {
              completed:
                true,
              completedAt:
                new Date()
            }
          },
          {
            upsert:
              true
          }
        );


        console.log(
          "MONGODB_INDEXES_READY"
        );

      })()
        .catch(
          function(error) {

            // 인덱스 생성이 실패한 경우 다음 요청에서
            // 다시 시도할 수 있도록 캐시를 초기화한다.
            globalForMongo.mongoIndexesPromise =
              null;


            console.error(
              "MONGODB_INDEX_SETUP_ERROR:",
              error
            );


            throw error;
          }
        );
  }


  await globalForMongo.mongoIndexesPromise;
}


// =========================================================
// MongoClient
// =========================================================

export async function getMongoClient() {

  return await clientPromise;
}


// =========================================================
// Qmanyity DB
// =========================================================

export async function getDatabase() {

  const client =
    await clientPromise;


  const db =
    client.db(
      "qmanyity"
    );


  void ensureDatabaseIndexes(
    db
  ).catch(
    function(error) {
      console.error(
        "MONGODB_BACKGROUND_INDEX_SETUP_ERROR:",
        error
      );
    }
  );


  return db;
}
