import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import fp from "fastify-plugin";
import { ApiKeyStrategy } from "@/server/auth/api-key.js";
import type { AuthStrategy, Principal } from "@/server/auth/strategy.js";
import { UnauthorizedError } from "@/server/errors.js";

/**
 * 让 `request.principal` 在 TypeScript 里被 fastify 认得。Module
 * augmentation 必须在加载这个 plugin 的入口处生效，所以放在 plugin
 * 文件顶部。
 */
declare module "fastify" {
  interface FastifyRequest {
    principal: Principal;
  }
}

interface AuthPluginOptions extends FastifyPluginOptions {
  /**
   * Server-internal strategy 注入点 — 测试可以传 mock，生产模式默认用
   * V1 的 {@link ApiKeyStrategy}。V3 Cloud 部署改成 JwtStrategy 也只
   * 改这一处，route handler 不变。
   */
  strategy?: AuthStrategy;
  /**
   * 不走 auth 的 URL 列表（精确匹配 `req.routeOptions.url`，即注册时
   * 写的 path，含路径参数占位符 `:id` 等）。
   *
   * V1 跳过的：`/health` 是 monitor probe，`/dev` 是 dev-only 上传页，
   * `/dev/*` 是 dev-only API。`/api/docs` 是 Wave 3 swagger UI 的占位。
   */
  skipPaths?: string[];
}

const DEFAULT_SKIP_PATHS = [
  "/health",
  "/dev",
  "/dev/clear-snap-mind",
  "/api/docs",
];

/**
 * Fastify auth plugin — 注册一个 preHandler hook 给所有非 skip 路径
 * 跑 `strategy.authenticate(req)`，成功把 principal 挂到 request 上，
 * 失败抛 `UnauthorizedError`（由 error-handler plugin 转成统一信封）。
 *
 * **必须用 fastify-plugin 包**：否则 decorateRequest / hook 只对此
 * plugin scope 内的路由生效，把 routes 注册在外层时 `request.principal`
 * 会是 undefined。
 */
async function authPlugin(
  app: FastifyInstance,
  opts: AuthPluginOptions,
): Promise<void> {
  const strategy = opts.strategy ?? new ApiKeyStrategy();
  const skipPaths = new Set(opts.skipPaths ?? DEFAULT_SKIP_PATHS);

  // Fastify 5: passing only the property name reserves the slot without
  // assigning a value. We populate it in the preHandler hook below; skip
  // routes never read `request.principal`, so the undefined-until-set
  // window is contained.
  app.decorateRequest("principal");

  app.addHook("preHandler", async (req) => {
    const url = req.routeOptions.url;
    if (url && skipPaths.has(url)) {
      return;
    }

    const result = await strategy.authenticate(req);
    if (!result.ok) {
      throw new UnauthorizedError(result.error.message);
    }
    req.principal = result.principal;
  });
}

export default fp(authPlugin, {
  name: "snap-mind-auth",
  fastify: "5.x",
});
