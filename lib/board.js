// =========================================================
// Qmanyity 게시판 공통 데이터 구조
// =========================================================
//
// 10단계에서는 게시판 화면/API를 아직 구현하지 않고,
// 이후 단계에서 사용할 MongoDB 컬렉션명과 문서 기본 구조를
// 한 곳에서 관리할 수 있도록 준비한다.
//
// MongoDB는 스키마리스 DB이지만, 아래 생성 함수를 통해
// 게시물/댓글/좋아요가 동일한 필드 구조를 사용하도록 한다.
// =========================================================


export const BOARD_COLLECTIONS =
  Object.freeze({
    POSTS:
      "boardPosts",
    COMMENTS:
      "boardComments",
    LIKES:
      "boardLikes"
  });


export const BOARD_STATUS =
  Object.freeze({
    ACTIVE:
      "ACTIVE",
    DELETED:
      "DELETED"
  });


export const BOARD_LIMITS =
  Object.freeze({
    TITLE_MAX_LENGTH:
      100,
    CONTENT_MAX_LENGTH:
      5000,
    ADDITIONAL_CATEGORY_MAX_LENGTH:
      30,
    ADDITIONAL_CATEGORY_MAX_COUNT:
      5,
    COMMENT_MAX_LENGTH:
      1000
  });


// =========================================================
// 게시판 첨부 퀴즈 공개 범위
// =========================================================
//
// 게시판에서는 퀴즈를 "소개/첨부"하기 위한 최소 정보만 사용한다.
// 아래 projection에 없는 필드는 MongoDB에서 조회 단계부터 가져오지 않는다.
//
// 특히 다음 필드는 게시판 API에서 절대 내려보내지 않는다.
// - solution
// - correctAnswer
// - correctOptionId
// - answerExplanation
// - options
// - question
//
// 이후 quizzes 문서에 새 필드가 추가되어도 이 허용 목록을 수정하지 않는 한
// 게시판 응답에 자동으로 포함되지 않는다.
// =========================================================

export const BOARD_QUIZ_SAFE_PROJECTION =
  Object.freeze({
    _id: 1,
    title: 1,
    categoryOriginalName: 1,
    tags: 1,
    difficulty: 1,
    createdAt: 1
  });


export function serializeBoardAttachedQuiz(
  quiz
) {

  if (!quiz) {
    return null;
  }


  return {
    id:
      quiz._id
        ?.toString() ||
      "",

    title:
      String(
        quiz.title ||
        ""
      )
  };
}


export function serializeBoardQuizOption(
  quiz
) {

  if (!quiz) {
    return null;
  }


  return {
    id:
      quiz._id
        ?.toString() ||
      "",

    title:
      String(
        quiz.title ||
        ""
      ),

    category:
      String(
        quiz.categoryOriginalName ||
        "기타"
      ),

    additionalCategories:
      Array.isArray(
        quiz.tags
      )
        ? quiz.tags
            .map(
              value =>
                String(
                  value ||
                  ""
                ).trim()
            )
            .filter(
              Boolean
            )
        : [],

    difficulty:
      String(
        quiz.difficulty ||
        "보통"
      )
  };
}


// =========================================================
// 게시물 문서
// =========================================================
//
// boardPosts
// {
//   _id,
//   authorId,              ObjectId
//   authorNickname,        string
//   title,                 string
//   content,               string
//   additionalCategory,    string[] (선택, 최대 5개)
//   quizId,                ObjectId | null (선택)
//   likeCount,             number
//   commentCount,          number
//   viewCount,             number
//   status,                "ACTIVE" | "DELETED"
//   createdAt,             Date
//   updatedAt              Date
// }
// =========================================================

export function normalizeBoardAdditionalCategories(
  value
) {

  const source =
    Array.isArray(
      value
    )
      ? value
      : [value];


  const result =
    [];


  source.forEach(
    function(item) {

      const category =
        String(
          item ||
          ""
        ).trim();


      if (!category) {
        return;
      }


      const duplicated =
        result.some(
          function(existing) {

            return (
              existing.toLocaleLowerCase(
                "ko-KR"
              ) ===
              category.toLocaleLowerCase(
                "ko-KR"
              )
            );
          }
        );


      if (!duplicated) {
        result.push(
          category
        );
      }
    }
  );


  return result;
}


export function createBoardPostDocument({
  authorId,
  authorNickname,
  title,
  content,
  additionalCategories = [],
  quizId = null,
  now = new Date()
}) {

  return {
    authorId,
    authorNickname,
    title,
    content,

    // 기존 필드명을 유지하면서 값만 배열로 확장한다.
    // 기존 문자열 문서와 MongoDB 인덱스도 그대로 호환된다.
    additionalCategory:
      normalizeBoardAdditionalCategories(
        additionalCategories
      ),
    quizId,

    likeCount:
      0,
    commentCount:
      0,
    viewCount:
      0,

    status:
      BOARD_STATUS.ACTIVE,

    createdAt:
      now,
    updatedAt:
      now
  };
}


// =========================================================
// 댓글 문서
// =========================================================
//
// boardComments
// {
//   _id,
//   postId,                ObjectId
//   authorId,              ObjectId
//   authorNickname,        string
//   content,               string
//   status,                "ACTIVE" | "DELETED"
//   createdAt,             Date
//   updatedAt              Date
// }
// =========================================================

export function createBoardCommentDocument({
  postId,
  authorId,
  authorNickname,
  content,
  now = new Date()
}) {

  return {
    postId,
    authorId,
    authorNickname,
    content,

    status:
      BOARD_STATUS.ACTIVE,

    createdAt:
      now,
    updatedAt:
      now
  };
}


// =========================================================
// 게시물 좋아요 문서
// =========================================================
//
// boardLikes
// {
//   _id,
//   postId,                ObjectId
//   userId,                ObjectId
//   createdAt              Date
// }
//
// postId + userId UNIQUE 인덱스로 같은 사용자가 같은 게시물에
// 중복 좋아요 문서를 만드는 것을 DB에서도 차단한다.
// =========================================================

export function createBoardLikeDocument({
  postId,
  userId,
  now = new Date()
}) {

  return {
    postId,
    userId,
    createdAt:
      now
  };
}
