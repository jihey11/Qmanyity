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
  BOARD_COLLECTIONS,
  BOARD_LIMITS,
  BOARD_STATUS,
  BOARD_QUIZ_SAFE_PROJECTION,
  createBoardCommentDocument,
  createBoardLikeDocument,
  createBoardPostDocument,
  normalizeBoardAdditionalCategories,
  serializeBoardAttachedQuiz,
  serializeBoardQuizOption
} from "../lib/board.js";

import {
  guardApiRequest,
  isAllowedEnum
} from "../lib/api.js";


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
// 게시판 게시물
//
// 20단계부터 게시판 기능은 api/board.js에서 독립적으로 처리한다.
// 커뮤니티 채팅/공지/투표와 게시판 API를 분리해 유지보수 범위를 줄인다.
// =========================================================

function serializeBoardPost(
  post,
  attachedQuiz = null,
  currentUserId = null
) {

  const authorId =
    post.authorId
      ?.toString() ||
    "";


  return {
    id:
      post._id
        .toString(),

    authorId,

    isMine:
      Boolean(
        currentUserId &&
        authorId ===
          currentUserId.toString()
      ),

    authorNickname:
      post.authorNickname ||
      "사용자",

    title:
      post.title ||
      "",

    content:
      post.content ||
      "",

    additionalCategories:
      normalizeBoardAdditionalCategories(
        post.additionalCategory
      ),

    additionalCategory:
      normalizeBoardAdditionalCategories(
        post.additionalCategory
      )[0] ||
      "",

    quizId:
      post.quizId
        ?.toString() ||
      null,

    attachedQuiz:
      serializeBoardAttachedQuiz(
        attachedQuiz
      ),

    likeCount:
      Number(
        post.likeCount ||
        0
      ),

    commentCount:
      Number(
        post.commentCount ||
        0
      ),

    viewCount:
      Number(
        post.viewCount ||
        0
      ),

    createdAt:
      post.createdAt ||
      null,

    updatedAt:
      post.updatedAt ||
      null
  };
}



async function boardPosts(
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


    const keyword =
      String(
        url.searchParams.get(
          "q"
        ) ||
        ""
      ).trim();


    const category =
      String(
        url.searchParams.get(
          "category"
        ) ||
        ""
      ).trim();


    const sort =
      String(
        url.searchParams.get(
          "sort"
        ) ||
        "latest"
      ).trim();


    if (keyword.length > 100) {
      return jsonResponse(
        {
          success: false,
          message: "검색어는 100자 이하로 입력해주세요."
        },
        400
      );
    }


    if (
      category.length >
      BOARD_LIMITS.ADDITIONAL_CATEGORY_MAX_LENGTH
    ) {
      return jsonResponse(
        {
          success: false,
          message: `부가 카테고리는 ${BOARD_LIMITS.ADDITIONAL_CATEGORY_MAX_LENGTH}자 이하만 사용할 수 있습니다.`
        },
        400
      );
    }


    if (
      !isAllowedEnum(
        sort,
        [
          "latest",
          "popular",
          "comments",
          "views"
        ]
      )
    ) {
      return jsonResponse(
        {
          success: false,
          message: "지원하지 않는 게시판 정렬 방식입니다."
        },
        400
      );
    }


    const filter = {
      status:
        BOARD_STATUS.ACTIVE
    };


    if (
      category &&
      category !==
        "전체"
    ) {

      filter.additionalCategory =
        category;
    }


    if (keyword) {

      const escapedKeyword =
        keyword.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        );


      const searchRegex =
        new RegExp(
          escapedKeyword,
          "i"
        );


      filter.$or = [
        { title: searchRegex },
        { content: searchRegex },
        { authorNickname: searchRegex },
        { additionalCategory: searchRegex }
      ];
    }


    const sortMap = {
      latest: {
        createdAt: -1
      },

      popular: {
        likeCount: -1,
        createdAt: -1
      },

      comments: {
        commentCount: -1,
        createdAt: -1
      },

      views: {
        viewCount: -1,
        createdAt: -1
      }
    };


    const sortOption =
      sortMap[sort] ||
      sortMap.latest;


    const postsCollection =
      auth.db.collection(
        BOARD_COLLECTIONS.POSTS
      );


    const [
      posts,
      rawCategories,
      total
    ] =
      await Promise.all([
        postsCollection
          .find(
            filter,
            {
              projection: {
                authorId: 1,
                authorNickname: 1,
                title: 1,
                content: 1,
                additionalCategory: 1,
                quizId: 1,
                likeCount: 1,
                commentCount: 1,
                viewCount: 1,
                createdAt: 1,
                updatedAt: 1
              }
            }
          )
          .sort(
            sortOption
          )
          .limit(
            200
          )
          .toArray(),

        postsCollection
          .distinct(
            "additionalCategory",
            {
              status:
                BOARD_STATUS.ACTIVE
            }
          ),

        postsCollection
          .countDocuments(
            filter
          )
      ]);


    const availableCategories =
      normalizeBoardAdditionalCategories(
        rawCategories
      )
        .sort(
          function(a, b) {
            return a.localeCompare(
              b,
              "ko"
            );
          }
        );


    const quizIds =
      [
        ...new Map(
          posts
            .filter(
              post =>
                post.quizId
            )
            .map(
              post => [
                post.quizId.toString(),
                post.quizId
              ]
            )
        ).values()
      ];


    const attachedQuizzes =
      quizIds.length
        ? await auth.db
            .collection(
              "quizzes"
            )
            .find(
              {
                _id: {
                  $in:
                    quizIds
                },
                status:
                  "ACTIVE"
              },
              {
                projection: {
                  _id:
                    BOARD_QUIZ_SAFE_PROJECTION._id,
                  title:
                    BOARD_QUIZ_SAFE_PROJECTION.title
                }
              }
            )
            .toArray()
        : [];


    const attachedQuizMap =
      new Map(
        attachedQuizzes.map(
          quiz => [
            quiz._id.toString(),
            quiz
          ]
        )
      );


    return jsonResponse({
      success: true,
      total:
        Number(
          total ||
          0
        ),
      categories:
        availableCategories,
      posts:
        posts.map(
          function(post) {
            return serializeBoardPost(
              post,
              post.quizId
                ? attachedQuizMap.get(
                    post.quizId.toString()
                  ) ||
                  null
                : null,
              auth.user._id
            );
          }
        )
    });


  } catch (error) {

    console.error(
      "BOARD_POSTS_ERROR:",
      error
    );


    return jsonResponse(
      {
        success: false,
        message:
          "게시물을 불러오는 중 오류가 발생했습니다."
      },
      500
    );
  }
}



async function boardPostDetail(
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


    const postIdText =
      String(
        url.searchParams.get(
          "postId"
        ) ||
        ""
      ).trim();


    if (
      !ObjectId.isValid(
        postIdText
      )
    ) {

      return jsonResponse(
        {
          success: false,
          message:
            "게시물 정보를 확인해주세요."
        },
        400
      );
    }


    const postId =
      new ObjectId(
        postIdText
      );


    const post =
      await auth.db
        .collection(
          BOARD_COLLECTIONS.POSTS
        )
        .findOne(
          {
            _id:
              postId,
            status:
              BOARD_STATUS.ACTIVE
          },
          {
            projection: {
              authorId: 1,
              authorNickname: 1,
              title: 1,
              content: 1,
              additionalCategory: 1,
              quizId: 1,
              likeCount: 1,
              commentCount: 1,
              viewCount: 1,
              createdAt: 1,
              updatedAt: 1
            }
          }
        );


    if (!post) {

      return jsonResponse(
        {
          success: false,
          message:
            "게시물을 찾을 수 없습니다."
        },
        404
      );
    }


    // 상세 화면을 정상적으로 연 경우 조회수를 1 증가시킨다.
    // 목록 전체를 다시 조회하지 않고 반환 데이터에도 즉시 반영한다.
    await auth.db
      .collection(
        BOARD_COLLECTIONS.POSTS
      )
      .updateOne(
        {
          _id:
            postId,
          status:
            BOARD_STATUS.ACTIVE
        },
        {
          $inc: {
            viewCount: 1
          }
        }
      );


    post.viewCount =
      Number(
        post.viewCount ||
        0
      ) + 1;


    // 좋아요 상태와 실제 좋아요 수는 상세 화면에서 함께 확인한다.
    // likeCount 집계값이 과거 오류 등으로 어긋난 경우 실제 boardLikes 개수로 자동 보정한다.
    const likesCollection =
      auth.db.collection(
        BOARD_COLLECTIONS.LIKES
      );


    const attachedQuizPromise =
      post.quizId
        ? auth.db
            .collection(
              "quizzes"
            )
            .findOne(
              {
                _id:
                  post.quizId,
                status:
                  "ACTIVE"
              },
              {
                // 게시물 상세에서도 정답 관련 필드는 조회하지 않는다.
                projection: {
                  _id:
                    BOARD_QUIZ_SAFE_PROJECTION._id,
                  title:
                    BOARD_QUIZ_SAFE_PROJECTION.title
                }
              }
            )
        : Promise.resolve(
            null
          );


    const [
      attachedQuiz,
      myLike,
      actualLikeCount
    ] =
      await Promise.all([
        attachedQuizPromise,

        likesCollection.findOne(
          {
            postId,
            userId:
              auth.user._id
          },
          {
            projection: {
              _id: 1
            }
          }
        ),

        likesCollection.countDocuments({
          postId
        })
      ]);


    const normalizedLikeCount =
      Math.max(
        0,
        Number(
          actualLikeCount ||
          0
        )
      );


    if (
      normalizedLikeCount !==
      Number(
        post.likeCount ||
        0
      )
    ) {

      await auth.db
        .collection(
          BOARD_COLLECTIONS.POSTS
        )
        .updateOne(
          {
            _id:
              postId,
            status:
              BOARD_STATUS.ACTIVE
          },
          {
            $set: {
              likeCount:
                normalizedLikeCount
            }
          }
        );
    }


    post.likeCount =
      normalizedLikeCount;


    const serializedPost =
      serializeBoardPost(
        post,
        attachedQuiz,
        auth.user._id
      );


    serializedPost.liked =
      Boolean(
        myLike
      );


    return jsonResponse({
      success: true,
      post:
        serializedPost
    });


  } catch (error) {

    console.error(
      "BOARD_POST_DETAIL_ERROR:",
      error
    );


    return jsonResponse(
      {
        success: false,
        message:
          "게시물을 불러오는 중 오류가 발생했습니다."
      },
      500
    );
  }
}



// =========================================================
// 게시판 댓글
//
// 16단계: 게시물 상세 화면에서 댓글 목록/작성/수정/삭제를 처리한다.
// 댓글 수정/삭제 권한은 브라우저 값이 아니라 로그인 사용자의 ObjectId로 검사한다.
// =========================================================

function serializeBoardComment(
  comment,
  currentUserId = null
) {

  const authorId =
    comment.authorId
      ?.toString() ||
    "";


  return {
    id:
      comment._id
        ?.toString() ||
      "",

    postId:
      comment.postId
        ?.toString() ||
      "",

    authorId,

    authorNickname:
      comment.authorNickname ||
      "사용자",

    content:
      comment.content ||
      "",

    createdAt:
      comment.createdAt ||
      null,

    updatedAt:
      comment.updatedAt ||
      null,

    isMine:
      Boolean(
        currentUserId &&
        authorId ===
          currentUserId.toString()
      )
  };
}


function getBoardObjectId(
  value
) {

  const text =
    String(
      value ||
      ""
    ).trim();


  if (
    !ObjectId.isValid(
      text
    )
  ) {
    return null;
  }


  return new ObjectId(
    text
  );
}


async function boardComments(
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


    const postId =
      getBoardObjectId(
        url.searchParams.get(
          "postId"
        )
      );


    if (!postId) {

      return jsonResponse(
        {
          success: false,
          message:
            "게시물 정보를 확인해주세요."
        },
        400
      );
    }


    const post =
      await auth.db
        .collection(
          BOARD_COLLECTIONS.POSTS
        )
        .findOne(
          {
            _id:
              postId,
            status:
              BOARD_STATUS.ACTIVE
          },
          {
            projection: {
              commentCount: 1
            }
          }
        );


    if (!post) {

      return jsonResponse(
        {
          success: false,
          message:
            "게시물을 찾을 수 없습니다."
        },
        404
      );
    }


    const commentsCollection =
      auth.db.collection(
        BOARD_COLLECTIONS.COMMENTS
      );


    const [
      newestComments,
      commentCount
    ] =
      await Promise.all([
        commentsCollection
          .find(
            {
              postId,
              status:
                BOARD_STATUS.ACTIVE
            },
            {
              projection: {
                postId: 1,
                authorId: 1,
                authorNickname: 1,
                content: 1,
                createdAt: 1,
                updatedAt: 1
              }
            }
          )
          .sort({
            createdAt: -1
          })
          .limit(300)
          .toArray(),

        commentsCollection
          .countDocuments({
            postId,
            status:
              BOARD_STATUS.ACTIVE
          })
      ]);


    // 집계 필드가 과거 오류나 수동 DB 수정으로 어긋났다면
    // 댓글 목록을 읽을 때 실제 ACTIVE 댓글 수로 자동 복구한다.
    if (
      Number(
        post.commentCount ||
        0
      ) !==
      commentCount
    ) {

      await auth.db
        .collection(
          BOARD_COLLECTIONS.POSTS
        )
        .updateOne(
          {
            _id:
              postId,
            status:
              BOARD_STATUS.ACTIVE
          },
          {
            $set: {
              commentCount
            }
          }
        );
    }


    return jsonResponse({
      success: true,
      commentCount,
      comments:
        newestComments
          .reverse()
          .map(
            comment =>
              serializeBoardComment(
                comment,
                auth.user._id
              )
          )
    });


  } catch (error) {

    console.error(
      "BOARD_COMMENTS_ERROR:",
      error
    );


    return jsonResponse(
      {
        success: false,
        message:
          "댓글을 불러오는 중 오류가 발생했습니다."
      },
      500
    );
  }
}


async function createBoardComment(
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

    const auth =
      await getAuth(
        request
      );


    if (!auth) {

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
            "요청 내용을 확인해주세요."
        },
        400
      );
    }


    const postId =
      getBoardObjectId(
        body.postId
      );


    const content =
      String(
        body.content ||
        ""
      ).trim();


    if (!postId) {

      return jsonResponse(
        {
          success: false,
          message:
            "게시물 정보를 확인해주세요."
        },
        400
      );
    }


    if (
      !content ||
      content.length >
        BOARD_LIMITS.COMMENT_MAX_LENGTH
    ) {

      return jsonResponse(
        {
          success: false,
          message:
            "댓글은 1~1000자로 입력해주세요."
        },
        400
      );
    }


    const post =
      await auth.db
        .collection(
          BOARD_COLLECTIONS.POSTS
        )
        .findOne(
          {
            _id:
              postId,
            status:
              BOARD_STATUS.ACTIVE
          },
          {
            projection: {
              _id: 1
            }
          }
        );


    if (!post) {

      return jsonResponse(
        {
          success: false,
          message:
            "게시물을 찾을 수 없습니다."
        },
        404
      );
    }


    const comment =
      createBoardCommentDocument({
        postId,
        authorId:
          auth.user._id,
        authorNickname:
          auth.user.nickname ||
          "사용자",
        content
      });


    const commentsCollection =
      auth.db.collection(
        BOARD_COLLECTIONS.COMMENTS
      );


    const inserted =
      await commentsCollection
        .insertOne(
          comment
        );


    comment._id =
      inserted.insertedId;


    let updatedPost;


    try {

      updatedPost =
        await auth.db
          .collection(
            BOARD_COLLECTIONS.POSTS
          )
          .findOneAndUpdate(
            {
              _id:
                postId,
              status:
                BOARD_STATUS.ACTIVE
            },
            {
              $inc: {
                commentCount: 1
              }
            },
            {
              returnDocument:
                "after",
              projection: {
                commentCount: 1
              }
            }
          );

    } catch (error) {

      // 게시물 집계 업데이트가 실패하면 방금 만든 댓글을 정리해
      // 댓글 문서와 commentCount가 서로 어긋나지 않게 한다.
      await commentsCollection
        .deleteOne({
          _id:
            comment._id
        })
        .catch(
          () => {}
        );

      throw error;
    }


    if (!updatedPost) {

      await commentsCollection
        .deleteOne({
          _id:
            comment._id
        });


      return jsonResponse(
        {
          success: false,
          message:
            "게시물을 찾을 수 없습니다."
        },
        404
      );
    }


    return jsonResponse(
      {
        success: true,
        comment:
          serializeBoardComment(
            comment,
            auth.user._id
          ),
        commentCount:
          Number(
            updatedPost.commentCount ||
            0
          )
      },
      201
    );


  } catch (error) {

    console.error(
      "BOARD_COMMENT_CREATE_ERROR:",
      error
    );


    return jsonResponse(
      {
        success: false,
        message:
          "댓글을 등록하는 중 오류가 발생했습니다."
      },
      500
    );
  }
}


async function updateBoardComment(
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

    const auth =
      await getAuth(
        request
      );


    if (!auth) {

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
            "요청 내용을 확인해주세요."
        },
        400
      );
    }


    const commentId =
      getBoardObjectId(
        body.commentId
      );


    const content =
      String(
        body.content ||
        ""
      ).trim();


    if (!commentId) {

      return jsonResponse(
        {
          success: false,
          message:
            "댓글 정보를 확인해주세요."
        },
        400
      );
    }


    if (
      !content ||
      content.length >
        BOARD_LIMITS.COMMENT_MAX_LENGTH
    ) {

      return jsonResponse(
        {
          success: false,
          message:
            "댓글은 1~1000자로 입력해주세요."
        },
        400
      );
    }


    const updated =
      await auth.db
        .collection(
          BOARD_COLLECTIONS.COMMENTS
        )
        .findOneAndUpdate(
          {
            _id:
              commentId,
            authorId:
              auth.user._id,
            status:
              BOARD_STATUS.ACTIVE
          },
          {
            $set: {
              content,
              updatedAt:
                new Date()
            }
          },
          {
            returnDocument:
              "after"
          }
        );


    if (!updated) {

      return jsonResponse(
        {
          success: false,
          message:
            "본인이 작성한 댓글만 수정할 수 있습니다."
        },
        403
      );
    }


    return jsonResponse({
      success: true,
      comment:
        serializeBoardComment(
          updated,
          auth.user._id
        )
    });


  } catch (error) {

    console.error(
      "BOARD_COMMENT_UPDATE_ERROR:",
      error
    );


    return jsonResponse(
      {
        success: false,
        message:
          "댓글을 수정하는 중 오류가 발생했습니다."
      },
      500
    );
  }
}


async function deleteBoardComment(
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

    const auth =
      await getAuth(
        request
      );


    if (!auth) {

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
            "요청 내용을 확인해주세요."
        },
        400
      );
    }


    const commentId =
      getBoardObjectId(
        body.commentId
      );


    if (!commentId) {

      return jsonResponse(
        {
          success: false,
          message:
            "댓글 정보를 확인해주세요."
        },
        400
      );
    }


    const deleted =
      await auth.db
        .collection(
          BOARD_COLLECTIONS.COMMENTS
        )
        .findOneAndUpdate(
          {
            _id:
              commentId,
            authorId:
              auth.user._id,
            status:
              BOARD_STATUS.ACTIVE
          },
          {
            $set: {
              status:
                BOARD_STATUS.DELETED,
              updatedAt:
                new Date()
            }
          },
          {
            returnDocument:
              "after",
            projection: {
              postId: 1
            }
          }
        );


    if (!deleted) {

      return jsonResponse(
        {
          success: false,
          message:
            "본인이 작성한 댓글만 삭제할 수 있습니다."
        },
        403
      );
    }


    const postsCollection =
      auth.db.collection(
        BOARD_COLLECTIONS.POSTS
      );


    // ACTIVE 댓글을 한 번만 DELETED로 바꿀 수 있으므로
    // 같은 요청을 반복해도 commentCount가 여러 번 감소하지 않는다.
    await postsCollection
      .updateOne(
        {
          _id:
            deleted.postId,
          status:
            BOARD_STATUS.ACTIVE,
          commentCount: {
            $gt: 0
          }
        },
        {
          $inc: {
            commentCount: -1
          }
        }
      );


    const post =
      await postsCollection
        .findOne(
          {
            _id:
              deleted.postId,
            status:
              BOARD_STATUS.ACTIVE
          },
          {
            projection: {
              commentCount: 1
            }
          }
        );


    return jsonResponse({
      success: true,
      commentCount:
        Number(
          post?.commentCount ||
          0
        )
    });


  } catch (error) {

    console.error(
      "BOARD_COMMENT_DELETE_ERROR:",
      error
    );


    return jsonResponse(
      {
        success: false,
        message:
          "댓글을 삭제하는 중 오류가 발생했습니다."
      },
      500
    );
  }
}



// =========================================================
// 게시물 좋아요
//
// 17단계: 토글 명령이 아니라 원하는 최종 상태(liked)를 서버에 전달한다.
// 같은 요청이 재전송되어도 상태가 다시 뒤집히지 않으며,
// boardLikes의 postId + userId UNIQUE 인덱스가 중복 좋아요를 DB에서도 차단한다.
// =========================================================

async function setBoardLike(
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

    const auth =
      await getAuth(
        request
      );


    if (!auth) {

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
            "요청 내용을 확인해주세요."
        },
        400
      );
    }


    const postId =
      getBoardObjectId(
        body.postId
      );


    if (!postId) {

      return jsonResponse(
        {
          success: false,
          message:
            "게시물 정보를 확인해주세요."
        },
        400
      );
    }


    if (
      typeof body.liked !==
      "boolean"
    ) {

      return jsonResponse(
        {
          success: false,
          message:
            "좋아요 상태를 확인해주세요."
        },
        400
      );
    }


    const desiredLiked =
      body.liked;


    const postsCollection =
      auth.db.collection(
        BOARD_COLLECTIONS.POSTS
      );


    const post =
      await postsCollection
        .findOne(
          {
            _id:
              postId,
            status:
              BOARD_STATUS.ACTIVE
          },
          {
            projection: {
              _id: 1
            }
          }
        );


    if (!post) {

      return jsonResponse(
        {
          success: false,
          message:
            "게시물을 찾을 수 없습니다."
        },
        404
      );
    }


    const likesCollection =
      auth.db.collection(
        BOARD_COLLECTIONS.LIKES
      );


    if (desiredLiked) {

      const likeDocument =
        createBoardLikeDocument({
          postId,
          userId:
            auth.user._id
        });


      try {

        // upsert + UNIQUE 인덱스로 같은 요청이 여러 번 와도 좋아요는 한 개만 유지한다.
        await likesCollection
          .updateOne(
            {
              postId,
              userId:
                auth.user._id
            },
            {
              $setOnInsert:
                likeDocument
            },
            {
              upsert: true
            }
          );

      } catch (error) {

        // 거의 동시에 같은 좋아요 요청이 들어온 경우 UNIQUE 인덱스의
        // duplicate key는 이미 원하는 상태가 만들어졌다는 의미이므로 성공으로 본다.
        if (
          error?.code !==
          11000
        ) {
          throw error;
        }
      }

    } else {

      await likesCollection
        .deleteOne({
          postId,
          userId:
            auth.user._id
        });
    }


    const [
      currentLike,
      actualLikeCount
    ] =
      await Promise.all([
        likesCollection.findOne(
          {
            postId,
            userId:
              auth.user._id
          },
          {
            projection: {
              _id: 1
            }
          }
        ),

        likesCollection.countDocuments({
          postId
        })
      ]);


    const normalizedLikeCount =
      Math.max(
        0,
        Number(
          actualLikeCount ||
          0
        )
      );


    const updatedPost =
      await postsCollection
        .findOneAndUpdate(
          {
            _id:
              postId,
            status:
              BOARD_STATUS.ACTIVE
          },
          {
            $set: {
              likeCount:
                normalizedLikeCount
            }
          },
          {
            returnDocument:
              "after",
            projection: {
              likeCount: 1
            }
          }
        );


    if (!updatedPost) {

      // 게시물이 좋아요 처리 도중 삭제된 경우 고아 좋아요가 남지 않도록 정리한다.
      await likesCollection
        .deleteOne({
          postId,
          userId:
            auth.user._id
        })
        .catch(
          () => {}
        );


      return jsonResponse(
        {
          success: false,
          message:
            "게시물을 찾을 수 없습니다."
        },
        404
      );
    }


    return jsonResponse({
      success: true,
      liked:
        Boolean(
          currentLike
        ),
      likeCount:
        Number(
          updatedPost.likeCount ||
          0
        )
    });


  } catch (error) {

    console.error(
      "BOARD_LIKE_SET_ERROR:",
      error
    );


    return jsonResponse(
      {
        success: false,
        message:
          "좋아요를 처리하는 중 오류가 발생했습니다."
      },
      500
    );
  }
}



async function boardQuizOptions(
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
          sessionExpired: true,
          message:
            "로그인이 필요합니다."
        },
        401
      );
    }


    const quizzes =
      await auth.db
        .collection(
          "quizzes"
        )
        .find(
          {
            status:
              "ACTIVE"
          },
          {
            // 허용 목록 기반 projection만 사용한다.
            // solution/options/question 등 정답 판정 필드는 DB 조회 단계에서 제외된다.
            projection:
              BOARD_QUIZ_SAFE_PROJECTION
          }
        )
        .sort({
          createdAt: -1
        })
        .limit(200)
        .toArray();


    return jsonResponse({
      success: true,
      quizzes:
        quizzes
          .map(
            serializeBoardQuizOption
          )
          .filter(
            Boolean
          )
    });


  } catch (error) {

    console.error(
      "BOARD_QUIZ_OPTIONS_ERROR:",
      error
    );


    return jsonResponse(
      {
        success: false,
        message:
          "첨부할 퀴즈를 불러오는 중 오류가 발생했습니다."
      },
      500
    );
  }
}


async function createBoardPost(
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

    const auth =
      await getAuth(
        request
      );


    if (!auth) {

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
            "요청 내용을 확인해주세요."
        },
        400
      );
    }


    const title =
      String(
        body.title ||
        ""
      ).trim();


    const content =
      String(
        body.content ||
        ""
      ).trim();


    const additionalCategories =
      normalizeBoardAdditionalCategories(
        Array.isArray(
          body.additionalCategories
        )
          ? body.additionalCategories
          : body.additionalCategory
      );


    const quizIdText =
      String(
        body.quizId ||
        ""
      ).trim();


    if (
      quizIdText &&
      !ObjectId.isValid(
        quizIdText
      )
    ) {

      return jsonResponse(
        {
          success: false,
          message:
            "첨부할 퀴즈 정보를 확인해주세요."
        },
        400
      );
    }


    let attachedQuiz =
      null;


    if (quizIdText) {

      attachedQuiz =
        await auth.db
          .collection(
            "quizzes"
          )
          .findOne(
            {
              _id:
                new ObjectId(
                  quizIdText
                ),
              status:
                "ACTIVE"
            },
            {
              projection: {
                _id:
                  BOARD_QUIZ_SAFE_PROJECTION._id,
                title:
                  BOARD_QUIZ_SAFE_PROJECTION.title
              }
            }
          );


      if (!attachedQuiz) {

        return jsonResponse(
          {
            success: false,
            message:
              "첨부할 퀴즈를 찾을 수 없습니다."
          },
          404
        );
      }
    }


    if (
      title.length < 2 ||
      title.length >
        BOARD_LIMITS.TITLE_MAX_LENGTH
    ) {

      return jsonResponse(
        {
          success: false,
          message:
            "게시물 제목은 2~100자로 입력해주세요."
        },
        400
      );
    }


    if (
      !content ||
      content.length >
        BOARD_LIMITS.CONTENT_MAX_LENGTH
    ) {

      return jsonResponse(
        {
          success: false,
          message:
            "게시물 내용은 1~5000자로 입력해주세요."
        },
        400
      );
    }


    if (
      additionalCategories.length >
        BOARD_LIMITS.ADDITIONAL_CATEGORY_MAX_COUNT
    ) {

      return jsonResponse(
        {
          success: false,
          message:
            "부가 카테고리는 최대 5개까지 추가할 수 있습니다."
        },
        400
      );
    }


    if (
      additionalCategories.some(
        function(category) {
          return (
            category.length >
            BOARD_LIMITS.ADDITIONAL_CATEGORY_MAX_LENGTH
          );
        }
      )
    ) {

      return jsonResponse(
        {
          success: false,
          message:
            "부가 카테고리는 각각 최대 30자까지 입력할 수 있습니다."
        },
        400
      );
    }


    const post =
      createBoardPostDocument({
        authorId:
          auth.user._id,

        authorNickname:
          auth.user.nickname ||
          "사용자",

        title,
        content,
        additionalCategories,

        quizId:
          attachedQuiz
            ? attachedQuiz._id
            : null
      });


    const inserted =
      await auth.db
        .collection(
          BOARD_COLLECTIONS.POSTS
        )
        .insertOne(
          post
        );


    post._id =
      inserted.insertedId;


    return jsonResponse(
      {
        success: true,
        post:
          serializeBoardPost(
            post,
            attachedQuiz,
            auth.user._id
          )
      },
      201
    );


  } catch (error) {

    console.error(
      "BOARD_POST_CREATE_ERROR:",
      error
    );


    return jsonResponse(
      {
        success: false,
        message:
          "게시물을 등록하는 중 오류가 발생했습니다."
      },
      500
    );
  }
}

// =========================================================
// 게시물 수정 / 삭제
// =========================================================

function validateBoardPostInput(
  body
) {

  const title =
    String(
      body?.title ||
      ""
    ).trim();

  const content =
    String(
      body?.content ||
      ""
    ).trim();

  const additionalCategories =
    normalizeBoardAdditionalCategories(
      Array.isArray(
        body?.additionalCategories
      )
        ? body.additionalCategories
        : body?.additionalCategory
    );

  if (
    title.length < 2 ||
    title.length >
      BOARD_LIMITS.TITLE_MAX_LENGTH
  ) {
    return {
      error:
        "게시물 제목은 2~100자로 입력해주세요."
    };
  }

  if (
    !content ||
    content.length >
      BOARD_LIMITS.CONTENT_MAX_LENGTH
  ) {
    return {
      error:
        "게시물 내용은 1~5000자로 입력해주세요."
    };
  }

  if (
    additionalCategories.length >
      BOARD_LIMITS.ADDITIONAL_CATEGORY_MAX_COUNT
  ) {
    return {
      error:
        "부가 카테고리는 최대 5개까지 추가할 수 있습니다."
    };
  }

  if (
    additionalCategories.some(
      category =>
        category.length >
        BOARD_LIMITS.ADDITIONAL_CATEGORY_MAX_LENGTH
    )
  ) {
    return {
      error:
        "부가 카테고리는 각각 최대 30자까지 입력할 수 있습니다."
    };
  }

  return {
    title,
    content,
    additionalCategories
  };
}


async function findSafeAttachedBoardQuiz(
  db,
  quizIdText
) {

  if (!quizIdText) {
    return {
      quizId: null,
      attachedQuiz: null
    };
  }

  if (
    !ObjectId.isValid(
      quizIdText
    )
  ) {
    return {
      error:
        "첨부할 퀴즈 정보를 확인해주세요."
    };
  }

  const attachedQuiz =
    await db
      .collection(
        "quizzes"
      )
      .findOne(
        {
          _id:
            new ObjectId(
              quizIdText
            ),
          status:
            "ACTIVE"
        },
        {
          projection: {
            _id:
              BOARD_QUIZ_SAFE_PROJECTION._id,
            title:
              BOARD_QUIZ_SAFE_PROJECTION.title
          }
        }
      );

  if (!attachedQuiz) {
    return {
      error:
        "첨부할 퀴즈를 찾을 수 없습니다."
    };
  }

  return {
    quizId:
      attachedQuiz._id,
    attachedQuiz
  };
}


async function updateBoardPost(
  request
) {

  if (request.method !== "POST") {
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
    const auth =
      await getAuth(
        request
      );

    if (!auth) {
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
            "요청 내용을 확인해주세요."
        },
        400
      );
    }

    const postId =
      getBoardObjectId(
        body?.postId
      );

    if (!postId) {
      return jsonResponse(
        {
          success: false,
          message:
            "게시물 정보를 확인해주세요."
        },
        400
      );
    }

    const postsCollection =
      auth.db.collection(
        BOARD_COLLECTIONS.POSTS
      );

    const post =
      await postsCollection
        .findOne(
          {
            _id: postId,
            status:
              BOARD_STATUS.ACTIVE
          },
          {
            projection: {
              authorId: 1,
              authorNickname: 1,
              title: 1,
              content: 1,
              additionalCategory: 1,
              quizId: 1,
              likeCount: 1,
              commentCount: 1,
              viewCount: 1,
              createdAt: 1,
              updatedAt: 1
            }
          }
        );

    if (!post) {
      return jsonResponse(
        {
          success: false,
          message:
            "게시물을 찾을 수 없습니다."
        },
        404
      );
    }

    if (
      post.authorId?.toString() !==
      auth.user._id.toString()
    ) {
      return jsonResponse(
        {
          success: false,
          message:
            "본인이 작성한 게시물만 수정할 수 있습니다."
        },
        403
      );
    }

    const validation =
      validateBoardPostInput(
        body
      );

    if (validation.error) {
      return jsonResponse(
        {
          success: false,
          message:
            validation.error
        },
        400
      );
    }

    const quizResult =
      await findSafeAttachedBoardQuiz(
        auth.db,
        String(
          body?.quizId ||
          ""
        ).trim()
      );

    if (quizResult.error) {
      return jsonResponse(
        {
          success: false,
          message:
            quizResult.error
        },
        400
      );
    }

    const now =
      new Date();

    const updateResult =
      await postsCollection
        .updateOne(
          {
            _id: postId,
            authorId:
              auth.user._id,
            status:
              BOARD_STATUS.ACTIVE
          },
          {
            $set: {
              title:
                validation.title,
              content:
                validation.content,
              additionalCategory:
                validation.additionalCategories,
              quizId:
                quizResult.quizId,
              updatedAt:
                now
            }
          }
        );

    if (!updateResult.matchedCount) {
      return jsonResponse(
        {
          success: false,
          message:
            "게시물 수정 권한을 확인할 수 없습니다."
        },
        409
      );
    }

    post.title =
      validation.title;
    post.content =
      validation.content;
    post.additionalCategory =
      validation.additionalCategories;
    post.quizId =
      quizResult.quizId;
    post.updatedAt =
      now;

    return jsonResponse({
      success: true,
      post:
        serializeBoardPost(
          post,
          quizResult.attachedQuiz,
          auth.user._id
        )
    });

  } catch (error) {
    console.error(
      "BOARD_POST_UPDATE_ERROR:",
      error
    );

    return jsonResponse(
      {
        success: false,
        message:
          "게시물을 수정하는 중 오류가 발생했습니다."
      },
      500
    );
  }
}


async function deleteBoardPost(
  request
) {

  if (request.method !== "POST") {
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
    const auth =
      await getAuth(
        request
      );

    if (!auth) {
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
            "요청 내용을 확인해주세요."
        },
        400
      );
    }

    const postId =
      getBoardObjectId(
        body?.postId
      );

    if (!postId) {
      return jsonResponse(
        {
          success: false,
          message:
            "게시물 정보를 확인해주세요."
        },
        400
      );
    }

    const postsCollection =
      auth.db.collection(
        BOARD_COLLECTIONS.POSTS
      );

    const post =
      await postsCollection
        .findOne(
          {
            _id: postId,
            status:
              BOARD_STATUS.ACTIVE
          },
          {
            projection: {
              authorId: 1
            }
          }
        );

    if (!post) {
      return jsonResponse(
        {
          success: false,
          message:
            "게시물을 찾을 수 없습니다."
        },
        404
      );
    }

    if (
      post.authorId?.toString() !==
      auth.user._id.toString()
    ) {
      return jsonResponse(
        {
          success: false,
          message:
            "본인이 작성한 게시물만 삭제할 수 있습니다."
        },
        403
      );
    }

    const now =
      new Date();

    const deleteResult =
      await postsCollection
        .updateOne(
          {
            _id: postId,
            authorId:
              auth.user._id,
            status:
              BOARD_STATUS.ACTIVE
          },
          {
            $set: {
              status:
                BOARD_STATUS.DELETED,
              updatedAt:
                now
            }
          }
        );

    if (!deleteResult.modifiedCount) {
      return jsonResponse(
        {
          success: false,
          message:
            "게시물을 삭제하지 못했습니다."
        },
        409
      );
    }

    // 게시물 자체가 삭제된 뒤 종속 데이터도 정리한다.
    // 게시물 삭제가 실패한 상태에서 댓글/좋아요만 사라지는 일을 방지한다.
    await Promise.all([
      auth.db
        .collection(
          BOARD_COLLECTIONS.COMMENTS
        )
        .updateMany(
          {
            postId,
            status:
              BOARD_STATUS.ACTIVE
          },
          {
            $set: {
              status:
                BOARD_STATUS.DELETED,
              updatedAt:
                now
            }
          }
        ),

      auth.db
        .collection(
          BOARD_COLLECTIONS.LIKES
        )
        .deleteMany({
          postId
        })
    ]);

    return jsonResponse({
      success: true,
      postId:
        postId.toString()
    });

  } catch (error) {
    console.error(
      "BOARD_POST_DELETE_ERROR:",
      error
    );

    return jsonResponse(
      {
        success: false,
        message:
          "게시물을 삭제하는 중 오류가 발생했습니다."
      },
      500
    );
  }
}


const BOARD_ACTION_GUARDS = Object.freeze({
  "board-posts": { methods: ["GET"], rateLimit: { key: "board:list", limit: 120, windowMs: 60_000 } },
  "board-post-detail": { methods: ["GET"], rateLimit: { key: "board:detail", limit: 120, windowMs: 60_000 } },
  "board-comments": { methods: ["GET"], rateLimit: { key: "board:comments:list", limit: 120, windowMs: 60_000 } },
  "create-board-comment": { methods: ["POST"], json: true, maxBodyBytes: 16 * 1024, rateLimit: { key: "board:comment:create", limit: 20, windowMs: 60_000 } },
  "update-board-comment": { methods: ["POST"], json: true, maxBodyBytes: 16 * 1024, rateLimit: { key: "board:comment:update", limit: 30, windowMs: 60_000 } },
  "delete-board-comment": { methods: ["POST"], json: true, maxBodyBytes: 8 * 1024, rateLimit: { key: "board:comment:delete", limit: 30, windowMs: 60_000 } },
  "set-board-like": { methods: ["POST"], json: true, maxBodyBytes: 8 * 1024, rateLimit: { key: "board:like", limit: 60, windowMs: 60_000 } },
  "board-quiz-options": { methods: ["GET"], rateLimit: { key: "board:quiz-options", limit: 60, windowMs: 60_000 } },
  "create-board-post": { methods: ["POST"], json: true, maxBodyBytes: 32 * 1024, rateLimit: { key: "board:post:create", limit: 10, windowMs: 60_000 } },
  "update-board-post": { methods: ["POST"], json: true, maxBodyBytes: 32 * 1024, rateLimit: { key: "board:post:update", limit: 20, windowMs: 60_000 } },
  "delete-board-post": { methods: ["POST"], json: true, maxBodyBytes: 8 * 1024, rateLimit: { key: "board:post:delete", limit: 20, windowMs: 60_000 } }
});

// =========================================================
// 게시판 전용 Router
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
      ) ||
      "";

    const actionGuard =
      BOARD_ACTION_GUARDS[action];


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

      case "board-posts":
        return boardPosts(request);

      case "board-post-detail":
        return boardPostDetail(request);

      case "board-comments":
        return boardComments(request);

      case "create-board-comment":
        return createBoardComment(request);

      case "update-board-comment":
        return updateBoardComment(request);

      case "delete-board-comment":
        return deleteBoardComment(request);

      case "set-board-like":
        return setBoardLike(request);

      case "board-quiz-options":
        return boardQuizOptions(request);

      case "create-board-post":
        return createBoardPost(request);

      case "update-board-post":
        return updateBoardPost(request);

      case "delete-board-post":
        return deleteBoardPost(request);

      default:
        return jsonResponse(
          {
            success: false,
            message:
              "존재하지 않는 게시판 API입니다."
          },
          404
        );
    }
  }
};
