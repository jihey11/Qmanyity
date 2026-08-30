const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_MAX_URL_LENGTH = 4096;
const RATE_BUCKET_STORE_KEY = "__qmanyityRateLimitBucketsV1";

function getRateBucketStore() {
  if (!globalThis[RATE_BUCKET_STORE_KEY]) {
    globalThis[RATE_BUCKET_STORE_KEY] = new Map();
  }
  return globalThis[RATE_BUCKET_STORE_KEY];
}

function jsonError(message, status, extraHeaders = {}) {
  return new Response(
    JSON.stringify({ success: false, message }),
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

function getClientKey(request) {
  const forwarded =
    request.headers.get("x-vercel-forwarded-for") ||
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    "";

  const ip = String(forwarded).split(",")[0].trim();
  return ip ? ip.slice(0, 120) : "local-client";
}

function cleanupExpiredBuckets(store, now) {
  if (store.size < 1000) return;
  for (const [key, value] of store.entries()) {
    if (!value || Number(value.resetAt || 0) <= now) {
      store.delete(key);
    }
  }
}

function applyRateLimit(request, options) {
  if (!options) return null;

  const limit = Math.max(1, Number(options.limit || 1));
  const windowMs = Math.max(1000, Number(options.windowMs || 60_000));
  const routeKey = String(options.key || "api").slice(0, 120);
  const clientKey = getClientKey(request);
  const now = Date.now();
  const store = getRateBucketStore();

  cleanupExpiredBuckets(store, now);

  const key = `${routeKey}:${clientKey}`;
  let bucket = store.get(key);

  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
  }

  bucket.count += 1;
  store.set(key, bucket);

  if (bucket.count <= limit) return null;

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((bucket.resetAt - now) / 1000)
  );

  return jsonError(
    "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
    429,
    {
      "Retry-After": String(retryAfterSeconds),
      "X-RateLimit-Limit": String(limit),
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": String(Math.ceil(bucket.resetAt / 1000))
    }
  );
}

async function validateJsonBody(request, maxBodyBytes) {
  const contentType = String(
    request.headers.get("content-type") || ""
  ).toLowerCase();

  if (!contentType.startsWith("application/json")) {
    return jsonError(
      "JSON 요청은 Content-Type: application/json 형식이어야 합니다.",
      415
    );
  }

  const contentLengthValue = request.headers.get("content-length");
  if (contentLengthValue) {
    const contentLength = Number(contentLengthValue);
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      return jsonError("요청 데이터가 너무 큽니다.", 413);
    }
  }

  let text;
  try {
    text = await request.clone().text();
  } catch {
    return jsonError("요청 데이터를 읽을 수 없습니다.", 400);
  }

  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength > maxBodyBytes) {
    return jsonError("요청 데이터가 너무 큽니다.", 413);
  }

  if (!text.trim()) {
    return jsonError("요청 데이터가 비어 있습니다.", 400);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return jsonError("올바른 JSON 형식으로 요청해주세요.", 400);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return jsonError("JSON 요청 본문은 객체 형식이어야 합니다.", 400);
  }

  return null;
}

export async function guardApiRequest(
  request,
  {
    methods = ["GET"],
    json = false,
    maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
    maxUrlLength = DEFAULT_MAX_URL_LENGTH,
    rateLimit = null
  } = {}
) {
  const method = String(request.method || "GET").toUpperCase();
  const allowedMethods = methods.map(value => String(value).toUpperCase());

  if (!allowedMethods.includes(method)) {
    return jsonError(
      `${allowedMethods.join(" 또는 ")} 요청만 사용할 수 있습니다.`,
      405,
      { Allow: allowedMethods.join(", ") }
    );
  }

  if (String(request.url || "").length > maxUrlLength) {
    return jsonError("요청 URL이 너무 깁니다.", 414);
  }

  const rateError = applyRateLimit(request, rateLimit);
  if (rateError) return rateError;

  if (json) {
    const jsonErrorResponse = await validateJsonBody(request, maxBodyBytes);
    if (jsonErrorResponse) return jsonErrorResponse;
  }

  return null;
}

export function isAllowedEnum(value, allowedValues) {
  return allowedValues.includes(String(value || ""));
}
