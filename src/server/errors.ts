/**
 * V1 统一错误信封 — 参见 `docs/architecture/api-design.md` §3。
 *
 * 所有 HTTP 非 2xx response 一律是 `{ error: { code, message, details? } }`
 * shape。`code` 是 STABLE 的（snake_case），客户端按 code 做分支判断；
 * `message` 是给人看的，可改写。
 *
 * 用法:
 * ```ts
 * throw new NotFoundError("clip_not_found", ERR_CLIP_NOT_FOUND);
 * ```
 * 由 `src/server/plugins/error-handler.ts` 捕获并写出统一信封。
 */

import type { ErrorEnvelope } from "@/types/wire.js";

// ─── 错误文案常量 ──────────────────────────────────────────────────────
// 集中放，方便改文案、加 i18n、做日志/告警匹配。
// 文案是统一信封的 `message` 字段。

export const ERR_CLIP_NOT_FOUND = "Clip not found";
export const ERR_BATCH_NOT_FOUND = "Batch not found";
export const ERR_JOB_NOT_FOUND = "Job not found";
export const ERR_STICKY_SESSION_NOT_FOUND = "Sticky session not found";

export const ERR_MISSING_IMAGE = "Missing image file";
export const ERR_NO_IMAGES = "No image files provided";
export const ERR_MISSING_SESSION_ID =
  "Missing or empty sessionId query parameter";

export function errTooManyImages(max: number): string {
  return `Too many images. Max ${max} per batch`;
}

// ─── 错误码 ───────────────────────────────────────────────────────────

/**
 * V1 stable 错误码集合。增量演进时只能新增、不能改名。
 *
 * 每个 code 对应一个固定的 HTTP statusCode（见 {@link CODE_TO_STATUS}）。
 */
export type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "clip_not_found"
  | "job_not_found"
  | "batch_not_found"
  | "sticky_session_not_found"
  | "missing_image"
  | "no_images"
  | "too_many_images"
  | "missing_session_id"
  | "sticky_wrong_state"
  | "sticky_batch_full"
  | "rate_limited"
  | "internal_error";

const CODE_TO_STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  clip_not_found: 404,
  job_not_found: 404,
  batch_not_found: 404,
  sticky_session_not_found: 404,
  missing_image: 400,
  no_images: 400,
  too_many_images: 400,
  missing_session_id: 400,
  sticky_wrong_state: 409,
  sticky_batch_full: 400,
  rate_limited: 429,
  internal_error: 500,
};

// ─── 基类 + 子类 ───────────────────────────────────────────────────────

/**
 * 所有可控的 HTTP 错误的基类。
 *
 * Route handler 抛 `ApiError`（或子类）→ global error handler 捕获 →
 * `reply.status(error.statusCode).send(error.toJSON())`。
 *
 * 不要在这条链路里手工写 `reply.status(...).send(...)` 形成第三种错误
 * 形态，会破坏统一信封契约。
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = CODE_TO_STATUS[code];
    this.details = details;
  }

  toJSON(): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        // 只有显式传 details 时才放进信封 — 默认不带 `details: null` 字段，
        // wire format 是 optional shape（spec §3 表里 details 给的是
        // illustrative null，不是契约要求）。
        ...(this.details !== undefined && {
          details: this.details,
        }),
      },
    };
  }
}

/** 401 unauthorized — 缺 Authorization header / token 无效 / scheme 错。 */
export class UnauthorizedError extends ApiError {
  constructor(message = "Unauthorized") {
    super("unauthorized", message);
    this.name = "UnauthorizedError";
  }
}

/** 403 forbidden — 已认证但无权限（V2 占位，V1 暂不主动抛）。 */
export class ForbiddenError extends ApiError {
  constructor(message = "Forbidden") {
    super("forbidden", message);
    this.name = "ForbiddenError";
  }
}

/** 404 not_found 系列 — 接受具体的 not_found code（clip / job / batch / sticky）。 */
export class NotFoundError extends ApiError {
  constructor(
    code:
      | "clip_not_found"
      | "job_not_found"
      | "batch_not_found"
      | "sticky_session_not_found",
    message: string,
  ) {
    super(code, message);
    this.name = "NotFoundError";
  }
}

/** 400 bad_request 系列 — 接受具体的客户端错误 code。 */
export class BadRequestError extends ApiError {
  constructor(
    code:
      | "missing_image"
      | "no_images"
      | "too_many_images"
      | "missing_session_id"
      | "sticky_batch_full",
    message: string,
    details?: unknown,
  ) {
    super(code, message, details);
    this.name = "BadRequestError";
  }
}

/** 409 conflict — sticky session 进入非 buffering 状态后还想继续 push。 */
export class ConflictError extends ApiError {
  constructor(code: "sticky_wrong_state", message: string) {
    super(code, message);
    this.name = "ConflictError";
  }
}

/**
 * 429 rate_limited — 由 @fastify/rate-limit 的 errorResponseBuilder 抛出。
 *
 * `retryAfter` 给 limit 后多少秒可以再试，留作以后写到 `Retry-After`
 * header 的素材；目前 V1 没把它写到 response 里。
 */
export class RateLimitError extends ApiError {
  readonly retryAfter?: number;

  constructor(message: string, retryAfter?: number) {
    super("rate_limited", message);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}
