import type { FastifyError, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { ApiError, BadRequestError } from "@/server/errors.js";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Global error handler — 统一把所有错误转成 V1 错误信封。
 *
 * **必须最先注册**（在 rate-limit / multipart / routes 之前），让 plugin
 * 阶段也能享受到统一处理；否则 multipart 解析失败之类的错误会走 Fastify
 * 默认 handler，response shape 不一致。
 *
 * 处理顺序:
 * 1. {@link ApiError} 及子类 → 直接 `toJSON()` 写出
 * 2. Fastify 内置 ValidationError → 包成 `BadRequestError("missing_image", ...)`
 *    （目前 V1 没用 schema 校验，但为了 forward-compat 留这条分支）
 * 3. 其他 Error → `internal_error` 兜底，**不**把 stack / raw error 写进
 *    response；dev 模式下打 stack 到日志，生产只打 message
 */
async function errorHandlerPlugin(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send(error.toJSON());
    }

    // Fastify 内置 schema validation 错误 — 整体 reshape 进 envelope。
    // 这是 forward-compat 的分支：V1 routes 里没用 fastify schema，但
    // multipart 解析或未来加 schema 都会经此。
    const fastifyError = error as FastifyError;
    if (fastifyError.validation) {
      const message =
        error instanceof Error ? error.message : "Validation failed";
      const wrapped = new BadRequestError(
        "missing_image",
        message,
        fastifyError.validation,
      );
      return reply.status(wrapped.statusCode).send(wrapped.toJSON());
    }

    // 兜底 — 任何未捕获的异常。
    // pino 已配 redact，安全打 error 对象（含 stack）到日志。
    // response 只写一个固定文案，绝不带 stack 或原始 error message
    // 出去（避免泄漏内部细节 / 路径 / SQL 形态等）。
    request.log.error(
      {
        err: error,
        msg: "unhandled error in request",
      },
      isDev ? "internal error (dev mode, stack in err)" : "internal error",
    );

    return reply.status(500).send({
      error: {
        code: "internal_error",
        message: "An internal error occurred",
      },
    });
  });
}

export default fp(errorHandlerPlugin, {
  name: "snap-mind-error-handler",
  fastify: "5.x",
});
