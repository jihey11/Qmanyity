import {
  randomBytes,
  createHash
} from "node:crypto";

import {
  getDatabase
} from "./mongodb.js";


// =========================================================
// 세션 설정
// =========================================================

export const SESSION_COOKIE_NAME =
  "qmanyity_session";

const SESSION_LIFETIME_SECONDS =
  60 * 60 * 24 * 7;


// =========================================================
// 토큰 해시
// =========================================================

function hashToken(token) {

  return createHash("sha256")
    .update(token)
    .digest("hex");
}


// =========================================================
// 쿠키 읽기
// =========================================================

function getCookie(
  request,
  name
) {

  const cookieHeader =
    request.headers.get("cookie");


  if (!cookieHeader) {

    return null;
  }


  const cookies =
    cookieHeader.split(";");


  for (const cookie of cookies) {

    const trimmed =
      cookie.trim();


    const separatorIndex =
      trimmed.indexOf("=");


    if (separatorIndex === -1) {

      continue;
    }


    const key =
      trimmed.substring(
        0,
        separatorIndex
      );


    const value =
      trimmed.substring(
        separatorIndex + 1
      );


    if (key === name) {

      return value;
    }
  }


  return null;
}


// =========================================================
// 세션 생성
// =========================================================

export async function createSession(
  userId
) {

  const db =
    await getDatabase();


  const sessions =
    db.collection(
      "sessions"
    );


  const token =
    randomBytes(32)
      .toString("hex");


  const tokenHash =
    hashToken(token);


  const now =
    new Date();


  const expiresAt =
    new Date(
      now.getTime() +
      SESSION_LIFETIME_SECONDS * 1000
    );


  await sessions.insertOne({

    userId:
      userId,

    tokenHash:
      tokenHash,

    createdAt:
      now,

    expiresAt:
      expiresAt

  });


  return {

    token,
    expiresAt

  };
}


// =========================================================
// 로그인 쿠키
// =========================================================

export function createSessionCookie(
  token
) {

  const expires =
    new Date(
      Date.now() +
      SESSION_LIFETIME_SECONDS * 1000
    );


  return [

    `${SESSION_COOKIE_NAME}=${token}`,

    "HttpOnly",

    "Secure",

    "SameSite=Lax",

    "Path=/",

    `Max-Age=${SESSION_LIFETIME_SECONDS}`,

    `Expires=${expires.toUTCString()}`

  ].join("; ");
}


// =========================================================
// 로그아웃 쿠키
// =========================================================

export function createClearSessionCookie() {

  return [

    `${SESSION_COOKIE_NAME}=`,

    "HttpOnly",

    "Secure",

    "SameSite=Lax",

    "Path=/",

    "Max-Age=0",

    "Expires=Thu, 01 Jan 1970 00:00:00 GMT"

  ].join("; ");
}


// =========================================================
// 로그인 세션 확인
// =========================================================

export async function getSessionFromRequest(
  request
) {

  const token =
    getCookie(
      request,
      SESSION_COOKIE_NAME
    );


  if (!token) {

    return null;
  }


  const db =
    await getDatabase();


  const tokenHash =
    hashToken(token);


  const session =
    await db
      .collection("sessions")
      .findOne({

        tokenHash:
          tokenHash,

        expiresAt: {
          $gt:
            new Date()
        }

      });


  if (!session) {

    return null;
  }


  return session;
}


// =========================================================
// 세션 삭제
// =========================================================

export async function deleteSessionFromRequest(
  request
) {

  const token =
    getCookie(
      request,
      SESSION_COOKIE_NAME
    );


  if (!token) {

    return;
  }


  const db =
    await getDatabase();


  await db
    .collection("sessions")
    .deleteOne({

      tokenHash:
        hashToken(token)

    });
}