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

import {
  loadUserCharacterMap,
  normalizeCharacterState
} from "../lib/character.js";




// =========================================================
// 공통 응답
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
// 로그인 사용자
// =========================================================

async function getAuth(
  request
) {

  const session =
    await getSessionFromRequest(
      request
    );


  if (!session) {
    return null;
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
    return null;
  }


  return {
    session,
    user,
    db
  };
}


// =========================================================
// 관리자 권한
//
// 관리자 여부는 브라우저에서 전달받은 값이 아니라
// MongoDB의 users 문서에 저장된 role을 서버가 직접 확인한다.
// 일반 사용자가 개발자 도구에서 버튼을 강제로 실행하거나
// API를 직접 호출해도 이 검사를 통과할 수 없다.
// =========================================================

function isAdminUser(
  user
) {

  return Boolean(
    user &&
    String(
      user.role ||
      ""
    )
      .trim()
      .toUpperCase() ===
      "ADMIN"
  );
}


function requireAdmin(
  user,
  message =
    "관리자 권한이 필요합니다."
) {

  if (
    isAdminUser(
      user
    )
  ) {
    return null;
  }


  return jsonResponse(
    {
      success: false,
      message
    },
    403
  );
}


function requirePostMethod(
  request
) {

  if (
    request.method ===
    "POST"
  ) {
    return null;
  }


  return jsonResponse(
    {
      success: false,
      message:
        "허용되지 않은 요청 방식입니다."
    },
    405
  );
}


// =========================================================
// 전체방 정보
// =========================================================

function getGlobalRoom(
  user
) {

  return {

    _id:
      "global",

    name:
      "전체 커뮤니티",

    description:
      "모든 사용자가 참여하는 전체 채팅방입니다.",

    hasPassword:
      false,

    ownerId:
      null,

    status:
      "ACTIVE",

    isGlobal:
      true,

    joined:
      true,

    isOwner:
      false,

    canManage:
      isAdminUser(
        user
      )
  };
}


// =========================================================
// 전체 커뮤니티 접근 권한
//
// 8단계부터 별도의 사용자 채팅방은 사용하지 않는다.
// 기존 DB의 사용자 채팅방 데이터는 삭제하지 않지만 API에서는
// global 전체 커뮤니티만 접근할 수 있다.
// =========================================================

async function getRoomAccess(
  db,
  user,
  roomId
) {

  if (
    roomId !==
    "global"
  ) {

    return {
      room: null,
      joined: false,
      canManage: false
    };
  }


  return {

    room:
      getGlobalRoom(
        user
      ),

    joined:
      true,

    canManage:
      isAdminUser(
        user
      )
  };
}


// =========================================================
// 전체 채팅 피드용 공지 / 투표 동기화
// =========================================================

let globalFeedBackfillPromise = null;


function getNoticeFeedMessageId(
  noticeId
) {

  return (
    "notice:" +
    String(
      noticeId
    )
  );
}


function getPollFeedMessageId(
  pollId
) {

  return (
    "poll:" +
    String(
      pollId
    )
  );
}


function buildPollFeedOptions(
  poll,
  votes = []
) {

  return (
    poll.options ||
    []
  ).map(
    function(option) {

      return {

        id:
          option.id,

        text:
          option.text,

        count:
          votes.filter(
            vote =>
              vote.optionId ===
              option.id
          ).length
      };
    }
  );
}


async function syncNoticeFeedMessage(
  db,
  notice
) {

  await db
    .collection(
      "communityMessages"
    )
    .updateOne(

      {
        _id:
          getNoticeFeedMessageId(
            notice._id
          )
      },

      {
        $set: {

          roomId:
            notice.roomId ||
            "global",

          type:
            "NOTICE",

          noticeId:
            notice._id,

          senderId:
            notice.authorId ||
            null,

          senderNickname:
            notice.authorNickname ||
            "관리자",

          title:
            notice.title ||
            "공지",

          text:
            notice.content ||
            "",

          status:
            notice.status ||
            "ACTIVE",

          createdAt:
            notice.createdAt ||
            new Date(),

          updatedAt:
            notice.updatedAt ||
            new Date()
        }
      },

      {
        upsert:
          true
      }
    );
}


async function syncPollFeedMessage(
  db,
  poll,
  suppliedVotes = null
) {

  const votes =
    Array.isArray(
      suppliedVotes
    )
      ? suppliedVotes
      : await db
          .collection(
            "communityPollVotes"
          )
          .find({
            pollId:
              poll._id
          })
          .toArray();


  await db
    .collection(
      "communityMessages"
    )
    .updateOne(

      {
        _id:
          getPollFeedMessageId(
            poll._id
          )
      },

      {
        $set: {

          roomId:
            poll.roomId ||
            "global",

          type:
            "POLL",

          pollId:
            poll._id,

          senderId:
            poll.creatorId ||
            null,

          senderNickname:
            poll.creatorNickname ||
            "관리자",

          question:
            poll.question ||
            "투표",

          options:
            buildPollFeedOptions(
              poll,
              votes
            ),

          totalVotes:
            votes.length,

          status:
            poll.status ||
            "ACTIVE",

          createdAt:
            poll.createdAt ||
            new Date(),

          updatedAt:
            poll.updatedAt ||
            new Date()
        }
      },

      {
        upsert:
          true
      }
    );
}


const GLOBAL_FEED_BACKFILL_META_ID =
  "global-feed-backfill-v1";


async function ensureExistingGlobalItemsInFeed(
  db
) {

  if (
    !globalFeedBackfillPromise
  ) {

    globalFeedBackfillPromise =
      (async function() {

        // 서버리스 인스턴스가 새로 켜질 때마다 예전 공지/투표를
        // 다시 최대 60개씩 upsert하면 첫 채팅 로딩이 느려질 수 있다.
        // DB에 완료 마커를 남겨 전체 백필은 프로젝트 전체에서 한 번만 수행한다.
        const metaCollection =
          db.collection(
            "communityMeta"
          );


        const completed =
          await metaCollection.findOne({
            _id:
              GLOBAL_FEED_BACKFILL_META_ID,
            completed:
              true
          });


        if (
          completed
        ) {
          return;
        }


        const [
          notices,
          pollList
        ] =
          await Promise.all([

            db
              .collection(
                "communityNotices"
              )
              .find({
                roomId:
                  "global",
                status:
                  "ACTIVE"
              })
              .sort({
                createdAt:
                  -1
              })
              .limit(
                30
              )
              .toArray(),

            db
              .collection(
                "communityPolls"
              )
              .find({
                roomId:
                  "global",
                status:
                  "ACTIVE"
              })
              .sort({
                createdAt:
                  -1
              })
              .limit(
                30
              )
              .toArray()
          ]);


        const pollIds =
          pollList.map(
            poll =>
              poll._id
          );


        const votes =
          pollIds.length
            ? await db
                .collection(
                  "communityPollVotes"
                )
                .find({
                  pollId: {
                    $in:
                      pollIds
                  }
                })
                .toArray()
            : [];


        await Promise.all([

          ...notices.map(
            notice =>
              syncNoticeFeedMessage(
                db,
                notice
              )
          ),

          ...pollList.map(
            poll =>
              syncPollFeedMessage(
                db,
                poll,
                votes.filter(
                  vote =>
                    String(
                      vote.pollId
                    ) ===
                    String(
                      poll._id
                    )
                )
              )
          )
        ]);


        await metaCollection.updateOne(
          {
            _id:
              GLOBAL_FEED_BACKFILL_META_ID
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
      })()
      .catch(
        function(error) {

          globalFeedBackfillPromise =
            null;

          console.error(
            "COMMUNITY_FEED_BACKFILL_ERROR:",
            error
          );
        }
      );
  }


  await globalFeedBackfillPromise;
}


function serializeCommunityFeedItem(
  item,
  user,
  myVoteMap = new Map(),
  characterMap = new Map()
) {

  // 항상 users 컬렉션의 최신 캐릭터를 우선 사용한다.
  // 그래야 사용자가 코스튬을 바꾼 뒤 과거 채팅/공지/투표에서도
  // 다른 사람에게 새 코스튬이 보인다.
  const senderCharacter =
    characterMap.get(String(item.senderId || "")) ||
    item.senderCharacter ||
    normalizeCharacterState(null);


  if (
    item.status ===
    "DELETED"
  ) {

    return {
      type:
        "DELETED",
      id:
        String(
          item._id
        ),
      noticeId:
        item.noticeId
          ? String(
              item.noticeId
            )
          : null,
      pollId:
        item.pollId
          ? String(
              item.pollId
            )
          : null,
      updatedAt:
        item.updatedAt ||
        item.createdAt ||
        new Date()
    };
  }


  if (
    item.type ===
    "NOTICE"
  ) {

    return {
      type:
        "NOTICE",
      id:
        String(
          item._id
        ),
      noticeId:
        String(
          item.noticeId ||
          ""
        ),
      title:
        item.title ||
        "공지",
      content:
        item.text ||
        "",
      authorNickname:
        item.senderNickname ||
        "관리자",
      authorCharacter:
        senderCharacter,
      createdAt:
        item.createdAt,
      updatedAt:
        item.updatedAt
    };
  }


  if (
    item.type ===
    "POLL"
  ) {

    return {
      type:
        "POLL",
      id:
        String(
          item._id
        ),
      pollId:
        String(
          item.pollId ||
          ""
        ),
      question:
        item.question ||
        "투표",
      authorNickname:
        item.senderNickname ||
        "관리자",
      authorCharacter:
        senderCharacter,
      createdAt:
        item.createdAt,
      updatedAt:
        item.updatedAt,
      totalVotes:
        Number(
          item.totalVotes ||
          0
        ),
      myVoteOptionId:
        myVoteMap.get(
          String(
            item.pollId ||
            ""
          )
        ) ||
        null,
      options:
        Array.isArray(
          item.options
        )
          ? item.options.map(
              option => ({
                id:
                  option.id,
                text:
                  option.text,
                count:
                  Number(
                    option.count ||
                    0
                  )
              })
            )
          : []
    };
  }


  return {
    type:
      "CHAT",
    id:
      String(
        item._id
      ),
    senderId:
      String(
        item.senderId ||
        ""
      ),
    nickname:
      item.senderNickname ||
      "사용자",
    character:
      senderCharacter,
    text:
      item.text ||
      "",
    createdAt:
      item.createdAt,
    updatedAt:
      item.updatedAt,
    mine:
      String(
        item.senderId ||
        ""
      ) ===
      String(
        user._id
      )
  };
}


// =========================================================
// 전체 커뮤니티 정보
// =========================================================

async function rooms(
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

    const auth =
      await getAuth(
        request
      );


    if (!auth) {

      return jsonResponse(
        {
          success: false,
          message:
            "로그인이 필요합니다."
        },
        401
      );
    }


    return jsonResponse({

      success: true,

      rooms: [
        {
          ...getGlobalRoom(
            auth.user
          ),

          id:
            "global"
        }
      ]
    });


  } catch (error) {

    console.error(
      "COMMUNITY_GLOBAL_INFO_ERROR:",
      error
    );


    return jsonResponse(
      {
        success: false,
        message:
          "전체 커뮤니티 정보를 불러오지 못했습니다."
      },
      500
    );
  }
}


// =========================================================
// 사용자 채팅방 만들기 - 8단계부터 사용 중지
// =========================================================

async function createRoom(
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


  const auth =
    await getAuth(
      request
    );


  if (!auth) {

    return jsonResponse(
      {
        success: false,
        message:
          "로그인이 필요합니다."
      },
      401
    );
  }


  return jsonResponse(
    {
      success: false,
      message:
        "전체 커뮤니티에서는 별도의 채팅방을 만들 수 없습니다."
    },
    403
  );
}


// =========================================================
// 전체 커뮤니티 입장
// =========================================================

async function joinRoom(
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


  const auth =
    await getAuth(
      request
    );


  if (!auth) {

    return jsonResponse(
      {
        success: false,
        message:
          "로그인이 필요합니다."
      },
      401
    );
  }


  let body = {};


  try {
    body =
      await request.json();
  } catch {
    body = {};
  }


  const roomId =
    String(
      body.roomId ||
      "global"
    );


  if (
    roomId !==
    "global"
  ) {

    return jsonResponse(
      {
        success: false,
        message:
          "현재는 전체 커뮤니티만 이용할 수 있습니다."
      },
      403
    );
  }


  return jsonResponse({
    success: true
  });
}


// =========================================================
// 메시지 목록
// =========================================================

async function messages(
  request
) {

  try {

    const auth =
      await getAuth(
        request
      );


    if (!auth) {

      return jsonResponse(
        {
          success: false,
          message:
            "로그인이 필요합니다."
        },
        401
      );
    }


    const {
      db,
      user
    } = auth;


    const url =
      new URL(
        request.url
      );


    const roomId =
      String(
        url.searchParams.get(
          "roomId"
        ) ||
        "global"
      );


    const sinceValue =
      url.searchParams.get(
        "since"
      );


    const sinceDate =
      sinceValue
        ? new Date(
            sinceValue
          )
        : null;


    if (
      sinceValue &&
      (
        !sinceDate ||
        Number.isNaN(
          sinceDate.getTime()
        )
      )
    ) {
      return jsonResponse(
        {
          success: false,
          message: "잘못된 커뮤니티 동기화 시간입니다."
        },
        400
      );
    }


    const incremental =
      Boolean(
        sinceDate &&
        !Number.isNaN(
          sinceDate.getTime()
        )
      );


    // 쿼리 시작 시간을 다음 증분 조회 기준으로 반환한다.
    // 조회 중 새 데이터가 생성되어도 다음 요청에서 누락되지 않는다.
    const syncStartedAt =
      new Date();


    const access =
      await getRoomAccess(
        db,
        user,
        roomId
      );


    if (
      !access.room
    ) {

      return jsonResponse(
        {
          success: false,
          message:
            "채팅방을 찾을 수 없습니다."
        },
        404
      );
    }


    if (
      !access.joined
    ) {

      return jsonResponse(
        {
          success: false,
          message:
            "먼저 채팅방에 입장해주세요."
        },
        403
      );
    }


    await ensureExistingGlobalItemsInFeed(
      db
    );


    let list;


    if (
      incremental
    ) {

      // 이후 요청에서는 전체 100개를 다시 받지 않고
      // 마지막 동기화 이후 생성/수정/삭제된 항목만 가져온다.
      list =
        await db
          .collection(
            "communityMessages"
          )
          .find({
            roomId,
            $or: [
              {
                createdAt: {
                  $gt:
                    sinceDate
                }
              },
              {
                updatedAt: {
                  $gt:
                    sinceDate
                }
              }
            ]
          })
          .limit(
            150
          )
          .toArray();


      list.sort(
        function(first, second) {

          const firstTime =
            new Date(
              first.updatedAt ||
              first.createdAt ||
              0
            ).getTime();

          const secondTime =
            new Date(
              second.updatedAt ||
              second.createdAt ||
              0
            ).getTime();

          return (
            firstTime -
            secondTime
          );
        }
      );

    } else {

      // 첫 입장 때만 최근 피드 전체를 내려준다.
      list =
        await db
          .collection(
            "communityMessages"
          )
          .find({
            roomId,
            status: {
              $ne:
                "DELETED"
            }
          })
          .sort({
            createdAt:
              -1
          })
          .limit(
            100
          )
          .toArray();


      list.reverse();
    }


    const visiblePollIds =
      list
        .filter(
          item =>
            item.status !==
              "DELETED" &&
            item.type ===
              "POLL" &&
            item.pollId
        )
        .map(
          item =>
            item.pollId
        );


    const myPollVotes =
      visiblePollIds.length
        ? await db
            .collection(
              "communityPollVotes"
            )
            .find({
              pollId: {
                $in:
                  visiblePollIds
              },
              userId:
                user._id
            })
            .toArray()
        : [];


    const myVoteMap =
      new Map(
        myPollVotes.map(
          vote => [
            String(
              vote.pollId
            ),
            vote.optionId
          ]
        )
      );


    const communityCharacterMap =
      await loadUserCharacterMap(
        db,
        list.map(item => item.senderId).filter(Boolean)
      );


    const items =
      list.map(
        item =>
          serializeCommunityFeedItem(
            item,
            user,
            myVoteMap,
            communityCharacterMap
          )
      );


    return jsonResponse({
      success: true,
      canManage:
        access.canManage,
      incremental,
      serverTime:
        syncStartedAt.toISOString(),
      items,
      messages:
        items.filter(
          item =>
            item.type ===
            "CHAT"
        )
    });


  } catch (error) {

    console.error(
      "MESSAGES_ERROR:",
      error
    );


    return jsonResponse(
      {
        success: false,
        message:
          "메시지를 불러오지 못했습니다."
      },
      500
    );
  }
}


// =========================================================
// 메시지 보내기
// =========================================================

async function sendMessage(
  request
) {

  try {

    const auth =
      await getAuth(
        request
      );


    if (!auth) {

      return jsonResponse(
        {
          success: false,
          message:
            "로그인이 필요합니다."
        },
        401
      );
    }


    const {
      db,
      user
    } = auth;


    const body =
      await request.json();


    const roomId =
      String(
        body.roomId ||
        "global"
      );


    const text =
      String(
        body.text ||
        ""
      )
      .trim();


    if (
      !text ||
      text.length > 500
    ) {

      return jsonResponse(
        {
          success: false,
          message:
            "메시지는 1~500자로 입력해주세요."
        },
        400
      );
    }


    const access =
      await getRoomAccess(
        db,
        user,
        roomId
      );


    if (
      !access.room ||
      !access.joined
    ) {

      return jsonResponse(
        {
          success: false,
          message:
            "채팅방에 접근할 수 없습니다."
        },
        403
      );
    }


    const now =
      new Date();


    const messageDocument = {
      roomId,
      type:
        "CHAT",
      senderId:
        user._id,
      senderNickname:
        user.nickname,
      text,
      status:
        "ACTIVE",
      createdAt:
        now,
      updatedAt:
        now
    };


    const insertResult =
      await db
        .collection(
          "communityMessages"
        )
        .insertOne(
          messageDocument
        );


    messageDocument._id =
      insertResult.insertedId;

    messageDocument.senderCharacter =
      normalizeCharacterState(
        user.character
      );


    // 클라이언트가 전체 메시지 목록을 다시 조회하지 않고
    // 방금 보낸 메시지만 즉시 화면에 추가할 수 있도록 반환한다.
    return jsonResponse({
      success: true,
      item:
        serializeCommunityFeedItem(
          messageDocument,
          user
        ),
      serverTime:
        now.toISOString()
    });


  } catch (error) {

    console.error(
      "SEND_MESSAGE_ERROR:",
      error
    );


    return jsonResponse(
      {
        success: false,
        message:
          "메시지를 보내지 못했습니다."
      },
      500
    );
  }
}


// =========================================================
// 공지 목록
// =========================================================

async function notices(
  request
) {

  try {

    const auth =
      await getAuth(
        request
      );


    if (!auth) {

      return jsonResponse(
        {
          success: false
        },
        401
      );
    }


    const {
      db,
      user
    } = auth;


    const url =
      new URL(
        request.url
      );


    const roomId =
      String(
        url.searchParams.get(
          "roomId"
        ) ||
        "global"
      );


    const access =
      await getRoomAccess(
        db,
        user,
        roomId
      );


    if (
      !access.room ||
      !access.joined
    ) {

      return jsonResponse(
        {
          success: false,
          message:
            "채팅방에 접근할 수 없습니다."
        },
        403
      );
    }


    const list =
      await db
        .collection(
          "communityNotices"
        )
        .find({

          roomId,

          status:
            "ACTIVE"
        })
        .sort({

          createdAt:
            -1
        })
        .limit(
          30
        )
        .toArray();


    return jsonResponse({

      success: true,

      canManage:
        access.canManage,

      notices:
        list.map(
          function(notice) {

            return {

              id:
                notice._id
                  .toString(),

              title:
                notice.title,

              content:
                notice.content,

              authorNickname:
                notice.authorNickname,

              createdAt:
                notice.createdAt,

              updatedAt:
                notice.updatedAt
            };
          }
        )

    });


  } catch (error) {

    return jsonResponse(
      {
        success: false,
        message:
          "공지를 불러오지 못했습니다."
      },
      500
    );
  }
}


// =========================================================
// 공지 만들기
// =========================================================

async function createNotice(
  request
) {

  const methodError =
    requirePostMethod(
      request
    );


  if (methodError) {
    return methodError;
  }


  const auth =
    await getAuth(
      request
    );


  if (!auth) {

    return jsonResponse(
      {
        success: false
      },
      401
    );
  }


  const {
    db,
    user
  } = auth;


  // 관리자 권한은 users.role을 서버에서 직접 검사한다.
  const adminError =
    requireAdmin(
      user,
      "공지 작성은 관리자만 할 수 있습니다."
    );


  if (adminError) {
    return adminError;
  }


  const body =
    await request.json();


  const roomId =
    String(
      body.roomId ||
      "global"
    );


  const title =
    String(
      body.title ||
      ""
    )
    .trim();


  const content =
    String(
      body.content ||
      ""
    )
    .trim();


  const access =
    await getRoomAccess(
      db,
      user,
      roomId
    );


  if (
    !access.canManage
  ) {

    return jsonResponse(
      {
        success: false,
        message:
          "공지 작성 권한이 없습니다."
      },
      403
    );
  }


  if (
    title.length < 2 ||
    title.length > 100 ||
    !content ||
    content.length > 2000
  ) {

    return jsonResponse(
      {
        success: false,
        message:
          "공지 제목 또는 내용을 확인해주세요."
      },
      400
    );
  }


  const now =
    new Date();


  const noticeDocument = {

    roomId,

    title,

    content,

    authorId:
      user._id,

    authorNickname:
      user.nickname,

    status:
      "ACTIVE",

    createdAt:
      now,

    updatedAt:
      now
  };


  const insertResult =
    await db
      .collection(
        "communityNotices"
      )
      .insertOne(
        noticeDocument
      );


  noticeDocument._id =
    insertResult.insertedId;


  // 공지는 별도 공지 목록뿐 아니라 전체 채팅 피드에도 올라간다.
  await syncNoticeFeedMessage(
    db,
    noticeDocument
  );


  return jsonResponse({
    success: true,
    noticeId:
      insertResult.insertedId.toString()
  });
}

// =========================================================
// 공지 수정
// =========================================================

async function updateNotice(
  request
) {

  const methodError =
    requirePostMethod(
      request
    );


  if (methodError) {
    return methodError;
  }


  const auth =
    await getAuth(
      request
    );


  if (!auth) {

    return jsonResponse(
      {
        success: false
      },
      401
    );
  }


  const {
    db,
    user
  } = auth;


  // 관리자 권한은 users.role을 서버에서 직접 검사한다.
  const adminError =
    requireAdmin(
      user,
      "공지 수정은 관리자만 할 수 있습니다."
    );


  if (adminError) {
    return adminError;
  }


  const body =
    await request.json();


  if (
    !ObjectId.isValid(
      body.noticeId
    )
  ) {

    return jsonResponse(
      {
        success: false,
        message:
          "잘못된 공지입니다."
      },
      400
    );
  }


  const notice =
    await db
      .collection(
        "communityNotices"
      )
      .findOne({

        _id:
          new ObjectId(
            body.noticeId
          ),

        status:
          "ACTIVE"
      });


  if (!notice) {

    return jsonResponse(
      {
        success: false,
        message:
          "공지를 찾을 수 없습니다."
      },
      404
    );
  }


  const access =
    await getRoomAccess(
      db,
      user,
      notice.roomId
    );


  if (
    !access.canManage
  ) {

    return jsonResponse(
      {
        success: false,
        message:
          "공지 수정 권한이 없습니다."
      },
      403
    );
  }


  const title =
    String(
      body.title ||
      ""
    )
    .trim();


  const content =
    String(
      body.content ||
      ""
    )
    .trim();


  if (
    title.length < 2 ||
    title.length > 100 ||
    !content ||
    content.length > 2000
  ) {

    return jsonResponse(
      {
        success: false,
        message:
          "공지 내용을 확인해주세요."
      },
      400
    );
  }


  const now =
    new Date();


  await db
    .collection(
      "communityNotices"
    )
    .updateOne(

      {
        _id:
          notice._id
      },

      {
        $set: {

          title,

          content,

          updatedAt:
            now
        }
      }
    );


  // 공지 탭에서 수정한 내용도 전체 채팅의 공지 카드에 즉시 반영한다.
  await syncNoticeFeedMessage(
    db,
    {
      ...notice,
      title,
      content,
      updatedAt:
        now
    }
  );


  return jsonResponse({
    success: true
  });
}

// =========================================================
// 공지 삭제
// =========================================================

async function deleteNotice(
  request
) {

  const methodError =
    requirePostMethod(
      request
    );


  if (methodError) {
    return methodError;
  }


  const auth =
    await getAuth(
      request
    );


  if (!auth) {

    return jsonResponse(
      {
        success: false
      },
      401
    );
  }


  const {
    db,
    user
  } = auth;


  // 관리자 권한은 users.role을 서버에서 직접 검사한다.
  const adminError =
    requireAdmin(
      user,
      "공지 삭제는 관리자만 할 수 있습니다."
    );


  if (adminError) {
    return adminError;
  }


  const body =
    await request.json();


  if (
    !ObjectId.isValid(
      body.noticeId
    )
  ) {

    return jsonResponse(
      {
        success: false
      },
      400
    );
  }


  const notice =
    await db
      .collection(
        "communityNotices"
      )
      .findOne({

        _id:
          new ObjectId(
            body.noticeId
          )
      });


  if (!notice) {

    return jsonResponse(
      {
        success: false,
        message:
          "공지를 찾을 수 없습니다."
      },
      404
    );
  }


  const access =
    await getRoomAccess(
      db,
      user,
      notice.roomId
    );


  if (
    !access.canManage
  ) {

    return jsonResponse(
      {
        success: false,
        message:
          "공지 삭제 권한이 없습니다."
      },
      403
    );
  }


  const now =
    new Date();


  await db
    .collection(
      "communityNotices"
    )
    .updateOne(

      {
        _id:
          notice._id
      },

      {
        $set: {
          status:
            "DELETED",
          updatedAt:
            now
        }
      }
    );


  // 공지를 삭제하면 전체 채팅 피드에서도 함께 숨긴다.
  await db
    .collection(
      "communityMessages"
    )
    .updateOne(

      {
        _id:
          getNoticeFeedMessageId(
            notice._id
          )
      },

      {
        $set: {
          status:
            "DELETED",
          updatedAt:
            now
        }
      }
    );


  return jsonResponse({
    success: true
  });
}

// =========================================================
// 투표 목록
// =========================================================

async function polls(
  request
) {

  try {

    const auth =
      await getAuth(
        request
      );


    if (!auth) {

      return jsonResponse(
        {
          success: false
        },
        401
      );
    }


    const {
      db,
      user
    } = auth;


    const url =
      new URL(
        request.url
      );


    const roomId =
      String(
        url.searchParams.get(
          "roomId"
        ) ||
        "global"
      );


    const access =
      await getRoomAccess(
        db,
        user,
        roomId
      );


    if (
      !access.room ||
      !access.joined
    ) {

      return jsonResponse(
        {
          success: false,
          message:
            "채팅방에 접근할 수 없습니다."
        },
        403
      );
    }


    const pollList =
      await db
        .collection(
          "communityPolls"
        )
        .find({

          roomId,

          status:
            "ACTIVE"
        })
        .sort({
          createdAt:
            -1
        })
        .limit(
          30
        )
        .toArray();


    const pollIds =
      pollList.map(
        poll =>
          poll._id
      );


    const votes =
      pollIds.length
        ? await db
            .collection(
              "communityPollVotes"
            )
            .find({

              pollId: {
                $in:
                  pollIds
              }
            })
            .toArray()
        : [];


    const results =
      pollList.map(
        function(poll) {

          const pollVotes =
            votes.filter(
              function(vote) {

                return (
                  String(
                    vote.pollId
                  ) ===
                  String(
                    poll._id
                  )
                );
              }
            );


          const myVote =
            pollVotes.find(
              function(vote) {

                return (
                  String(
                    vote.userId
                  ) ===
                  String(
                    user._id
                  )
                );
              }
            );


          return {

            id:
              poll._id
                .toString(),

            question:
              poll.question,

            createdAt:
              poll.createdAt,

            totalVotes:
              pollVotes.length,

            myVoteOptionId:
              myVote
                ?.optionId ||
              null,

            options:
              (
                poll.options ||
                []
              )
              .map(
                function(option) {

                  return {

                    id:
                      option.id,

                    text:
                      option.text,

                    count:
                      pollVotes.filter(
                        vote =>
                          vote.optionId ===
                          option.id
                      ).length
                  };
                }
              )
          };
        }
      );


    return jsonResponse({

      success:
        true,

      canManage:
        access.canManage,

      polls:
        results
    });


  } catch (error) {

    console.error(
      "POLLS_ERROR:",
      error
    );


    return jsonResponse(
      {
        success: false,
        message:
          "투표를 불러오지 못했습니다."
      },
      500
    );
  }
}


// =========================================================
// 투표 만들기
// =========================================================

async function createPoll(
  request
) {

  const methodError =
    requirePostMethod(
      request
    );


  if (methodError) {
    return methodError;
  }


  const auth =
    await getAuth(
      request
    );


  if (!auth) {

    return jsonResponse(
      {
        success: false
      },
      401
    );
  }


  const {
    db,
    user
  } = auth;


  // 관리자 권한은 users.role을 서버에서 직접 검사한다.
  const adminError =
    requireAdmin(
      user,
      "투표 작성은 관리자만 할 수 있습니다."
    );


  if (adminError) {
    return adminError;
  }


  const body =
    await request.json();


  const roomId =
    String(
      body.roomId ||
      "global"
    );


  const access =
    await getRoomAccess(
      db,
      user,
      roomId
    );


  if (
    !access.canManage
  ) {

    return jsonResponse(
      {
        success: false,
        message:
          "투표 생성 권한이 없습니다."
      },
      403
    );
  }


  const question =
    String(
      body.question ||
      ""
    )
    .trim();


  const rawOptions =
    Array.isArray(
      body.options
    )
      ? body.options
      : [];


  const options =
    rawOptions
      .map(
        value =>
          String(
            value ||
            ""
          )
          .trim()
      )
      .filter(Boolean);


  if (
    question.length < 2 ||
    question.length > 150
  ) {

    return jsonResponse(
      {
        success: false,
        message:
          "투표 질문은 2~150자로 입력해주세요."
      },
      400
    );
  }


  if (
    options.length < 2 ||
    options.length > 6
  ) {

    return jsonResponse(
      {
        success: false,
        message:
          "투표 선택지는 2~6개가 필요합니다."
      },
      400
    );
  }


  if (
    options.some(
      option =>
        option.length > 100
    )
  ) {
    return jsonResponse(
      {
        success: false,
        message: "투표 선택지는 각각 100자 이하로 입력해주세요."
      },
      400
    );
  }


  if (
    new Set(
      options.map(
        option =>
          option.toLocaleLowerCase(
            "ko-KR"
          )
      )
    ).size !== options.length
  ) {
    return jsonResponse(
      {
        success: false,
        message: "같은 투표 선택지를 중복해서 등록할 수 없습니다."
      },
      400
    );
  }


  const now =
    new Date();


  const pollDocument = {

    roomId,

    question,

    options:
      options.map(
        function(text, index) {

          return {

            id:
              "option_" +
              (
                index + 1
              ),

            text
          };
        }
      ),

    creatorId:
      user._id,

    creatorNickname:
      user.nickname,

    status:
      "ACTIVE",

    createdAt:
      now,

    updatedAt:
      now
  };


  const insertResult =
    await db
      .collection(
        "communityPolls"
      )
      .insertOne(
        pollDocument
      );


  pollDocument._id =
    insertResult.insertedId;


  // 투표는 별도 투표 목록뿐 아니라 전체 채팅 피드에도 올라간다.
  await syncPollFeedMessage(
    db,
    pollDocument,
    []
  );


  return jsonResponse({
    success: true,
    pollId:
      insertResult.insertedId.toString()
  });
}

// =========================================================
// 투표 참여
// =========================================================

async function votePoll(
  request
) {

  const auth =
    await getAuth(
      request
    );


  if (!auth) {

    return jsonResponse(
      {
        success: false
      },
      401
    );
  }


  const {
    db,
    user
  } = auth;


  const body =
    await request.json();


  if (
    !ObjectId.isValid(
      body.pollId
    )
  ) {

    return jsonResponse(
      {
        success: false,
        message:
          "잘못된 투표입니다."
      },
      400
    );
  }


  const poll =
    await db
      .collection(
        "communityPolls"
      )
      .findOne({

        _id:
          new ObjectId(
            body.pollId
          ),

        status:
          "ACTIVE"
      });


  if (!poll) {

    return jsonResponse(
      {
        success: false,
        message:
          "투표를 찾을 수 없습니다."
      },
      404
    );
  }


  const access =
    await getRoomAccess(
      db,
      user,
      poll.roomId
    );


  if (
    !access.joined
  ) {

    return jsonResponse(
      {
        success: false,
        message:
          "채팅방에 입장해야 투표할 수 있습니다."
      },
      403
    );
  }


  const optionId =
    String(
      body.optionId ||
      ""
    );


  if (
    !poll.options.some(
      option =>
        option.id ===
        optionId
    )
  ) {

    return jsonResponse(
      {
        success: false,
        message:
          "올바른 선택지를 선택해주세요."
      },
      400
    );
  }


  await db
    .collection(
      "communityPollVotes"
    )
    .updateOne(

      {

        pollId:
          poll._id,

        userId:
          user._id
      },

      {

        $set: {

          optionId,

          updatedAt:
            new Date()
        },

        $setOnInsert: {

          createdAt:
            new Date()
        }
      },

      {
        upsert:
          true
      }
    );


  const votes =
    await db
      .collection(
        "communityPollVotes"
      )
      .find({
        pollId:
          poll._id
      })
      .toArray();


  // 전체 채팅에 표시되는 투표 카드의 득표수도 함께 갱신한다.
  // updatedAt을 현재 시각으로 바꿔 증분 피드 조회에서도 변경을 감지한다.
  const feedUpdatedAt =
    new Date();


  await syncPollFeedMessage(
    db,
    {
      ...poll,
      updatedAt:
        feedUpdatedAt
    },
    votes
  );


  return jsonResponse({
    success: true,
    item: {
      type:
        "POLL",
      id:
        getPollFeedMessageId(
          poll._id
        ),
      pollId:
        poll._id.toString(),
      question:
        poll.question,
      authorNickname:
        poll.creatorNickname ||
        "관리자",
      createdAt:
        poll.createdAt,
      updatedAt:
        feedUpdatedAt,
      totalVotes:
        votes.length,
      myVoteOptionId:
        optionId,
      options:
        buildPollFeedOptions(
          poll,
          votes
        )
    },
    serverTime:
      feedUpdatedAt.toISOString()
  });
}

// =========================================================
// 투표 수정
// =========================================================

async function updatePoll(
  request
) {

  const methodError =
    requirePostMethod(
      request
    );


  if (methodError) {
    return methodError;
  }


  const auth =
    await getAuth(
      request
    );


  if (!auth) {

    return jsonResponse(
      {
        success: false
      },
      401
    );
  }


  const {
    db,
    user
  } = auth;


  // 관리자 권한은 users.role을 서버에서 직접 검사한다.
  const adminError =
    requireAdmin(
      user,
      "투표 수정은 관리자만 할 수 있습니다."
    );


  if (adminError) {
    return adminError;
  }


  const body =
    await request.json();


  if (
    !ObjectId.isValid(
      body.pollId
    )
  ) {

    return jsonResponse(
      {
        success: false
      },
      400
    );
  }


  const poll =
    await db
      .collection(
        "communityPolls"
      )
      .findOne({

        _id:
          new ObjectId(
            body.pollId
          ),

        status:
          "ACTIVE"
      });


  if (!poll) {

    return jsonResponse(
      {
        success: false
      },
      404
    );
  }


  const access =
    await getRoomAccess(
      db,
      user,
      poll.roomId
    );


  if (
    !access.canManage
  ) {

    return jsonResponse(
      {
        success: false,
        message:
          "투표 수정 권한이 없습니다."
      },
      403
    );
  }


  const question =
    String(
      body.question ||
      ""
    )
    .trim();


  const options =
    Array.isArray(
      body.options
    )
      ? body.options
          .map(
            value =>
              String(
                value ||
                ""
              ).trim()
          )
          .filter(Boolean)
      : [];


  if (
    question.length < 2 ||
    question.length > 150 ||
    options.length < 2 ||
    options.length > 6 ||
    options.some(
      option =>
        option.length > 100
    )
  ) {

    return jsonResponse(
      {
        success: false,
        message:
          "투표 질문은 2~150자, 선택지는 2~6개이며 각각 100자 이하로 입력해주세요."
      },
      400
    );
  }


  if (
    new Set(
      options.map(
        option =>
          option.toLocaleLowerCase(
            "ko-KR"
          )
      )
    ).size !== options.length
  ) {
    return jsonResponse(
      {
        success: false,
        message: "같은 투표 선택지를 중복해서 등록할 수 없습니다."
      },
      400
    );
  }


  const voteCount =
    await db
      .collection(
        "communityPollVotes"
      )
      .countDocuments({

        pollId:
          poll._id
      });


  const oldTexts =
    poll.options.map(
      option =>
        option.text
    );


  const optionsChanged =
    JSON.stringify(
      oldTexts
    ) !==
    JSON.stringify(
      options
    );


  if (
    voteCount > 0 &&
    optionsChanged
  ) {

    return jsonResponse(
      {
        success: false,
        message:
          "이미 투표가 시작되어 선택지는 수정할 수 없습니다. 질문만 수정할 수 있습니다."
      },
      409
    );
  }


  const newOptions =
    optionsChanged
      ? options.map(
          function(text, index) {

            return {

              id:
                "option_" +
                (
                  index + 1
                ),

              text
            };
          }
        )
      : poll.options;


  const now =
    new Date();


  await db
    .collection(
      "communityPolls"
    )
    .updateOne(

      {
        _id:
          poll._id
      },

      {
        $set: {

          question,

          options:
            newOptions,

          updatedAt:
            now
        }
      }
    );


  // 투표 탭에서 수정한 내용도 전체 채팅의 투표 카드에 반영한다.
  await syncPollFeedMessage(
    db,
    {
      ...poll,
      question,
      options:
        newOptions,
      updatedAt:
        now
    }
  );


  return jsonResponse({
    success: true
  });
}

// =========================================================
// 투표 삭제
// =========================================================

async function deletePoll(
  request
) {

  const methodError =
    requirePostMethod(
      request
    );


  if (methodError) {
    return methodError;
  }


  const auth =
    await getAuth(
      request
    );


  if (!auth) {

    return jsonResponse(
      {
        success: false
      },
      401
    );
  }


  const {
    db,
    user
  } = auth;


  // 관리자 권한은 users.role을 서버에서 직접 검사한다.
  const adminError =
    requireAdmin(
      user,
      "투표 삭제는 관리자만 할 수 있습니다."
    );


  if (adminError) {
    return adminError;
  }


  const body =
    await request.json();


  if (
    !ObjectId.isValid(
      body.pollId
    )
  ) {

    return jsonResponse(
      {
        success: false
      },
      400
    );
  }


  const poll =
    await db
      .collection(
        "communityPolls"
      )
      .findOne({

        _id:
          new ObjectId(
            body.pollId
          )
      });


  if (!poll) {

    return jsonResponse(
      {
        success: false
      },
      404
    );
  }


  const access =
    await getRoomAccess(
      db,
      user,
      poll.roomId
    );


  if (
    !access.canManage
  ) {

    return jsonResponse(
      {
        success: false,
        message:
          "투표 삭제 권한이 없습니다."
      },
      403
    );
  }


  const now =
    new Date();


  await db
    .collection(
      "communityPolls"
    )
    .updateOne(

      {
        _id:
          poll._id
      },

      {
        $set: {

          status:
            "DELETED",

          updatedAt:
            now
        }
      }
    );


  // 투표를 삭제하면 전체 채팅 피드에서도 함께 숨긴다.
  await db
    .collection(
      "communityMessages"
    )
    .updateOne(

      {
        _id:
          getPollFeedMessageId(
            poll._id
          )
      },

      {
        $set: {
          status:
            "DELETED",
          updatedAt:
            now
        }
      }
    );


  return jsonResponse({
    success: true
  });
}

const COMMUNITY_ACTION_GUARDS = Object.freeze({
  rooms: { methods: ["GET"], rateLimit: { key: "community:rooms", limit: 60, windowMs: 60_000 } },
  "create-room": { methods: ["POST"], json: true, maxBodyBytes: 8 * 1024, rateLimit: { key: "community:create-room", limit: 10, windowMs: 60_000 } },
  "join-room": { methods: ["POST"], json: true, maxBodyBytes: 8 * 1024, rateLimit: { key: "community:join-room", limit: 20, windowMs: 60_000 } },
  messages: { methods: ["GET"], rateLimit: { key: "community:messages", limit: 180, windowMs: 60_000 } },
  "send-message": { methods: ["POST"], json: true, maxBodyBytes: 8 * 1024, rateLimit: { key: "community:send", limit: 30, windowMs: 60_000 } },
  notices: { methods: ["GET"], rateLimit: { key: "community:notices", limit: 60, windowMs: 60_000 } },
  "create-notice": { methods: ["POST"], json: true, maxBodyBytes: 16 * 1024, rateLimit: { key: "community:notice:create", limit: 15, windowMs: 60_000 } },
  "update-notice": { methods: ["POST"], json: true, maxBodyBytes: 16 * 1024, rateLimit: { key: "community:notice:update", limit: 20, windowMs: 60_000 } },
  "delete-notice": { methods: ["POST"], json: true, maxBodyBytes: 8 * 1024, rateLimit: { key: "community:notice:delete", limit: 20, windowMs: 60_000 } },
  polls: { methods: ["GET"], rateLimit: { key: "community:polls", limit: 60, windowMs: 60_000 } },
  "create-poll": { methods: ["POST"], json: true, maxBodyBytes: 24 * 1024, rateLimit: { key: "community:poll:create", limit: 15, windowMs: 60_000 } },
  "vote-poll": { methods: ["POST"], json: true, maxBodyBytes: 8 * 1024, rateLimit: { key: "community:poll:vote", limit: 60, windowMs: 60_000 } },
  "update-poll": { methods: ["POST"], json: true, maxBodyBytes: 24 * 1024, rateLimit: { key: "community:poll:update", limit: 20, windowMs: 60_000 } },
  "delete-poll": { methods: ["POST"], json: true, maxBodyBytes: 8 * 1024, rateLimit: { key: "community:poll:delete", limit: 20, windowMs: 60_000 } }
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
      COMMUNITY_ACTION_GUARDS[action];


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

      case "rooms":

        return rooms(
          request
        );


      case "create-room":

        return createRoom(
          request
        );


      case "join-room":

        return joinRoom(
          request
        );


      case "messages":

        return messages(
          request
        );


      case "send-message":

        return sendMessage(
          request
        );


      case "notices":

        return notices(
          request
        );


      case "create-notice":

        return createNotice(
          request
        );


      case "update-notice":

        return updateNotice(
          request
        );


      case "delete-notice":

        return deleteNotice(
          request
        );


      case "polls":

        return polls(
          request
        );


      case "create-poll":

        return createPoll(
          request
        );


      case "vote-poll":

        return votePoll(
          request
        );


      case "update-poll":

        return updatePoll(
          request
        );


      case "delete-poll":

        return deletePoll(
          request
        );


      default:

        return jsonResponse(
          {
            success: false,
            message:
              "존재하지 않는 커뮤니티 API입니다."
          },
          404
        );
    }
  }
};