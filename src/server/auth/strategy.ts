/**
 * AuthStrategy 抽象 — 让 server-internal 的认证机制可插拔。
 *
 * V1 只交付 {@link ./api-key.ts} 的 ApiKeyStrategy。V3 Cloud 时会加
 * `JwtStrategy`，并在启动时按部署模式选实现；route handler 一律读
 * `request.principal`，不关心是哪种 strategy 校验出来的。
 *
 * 参见 `docs/architecture/api-design.md` §4。
 */

import type { FastifyRequest } from "fastify";

/**
 * 认证主体 — request 通过 strategy 后挂在 `request.principal` 上。
 *
 * - `type: 'service'` 表示后台/CLI 客户端（V1 ApiKey 共享 token 走这条）
 * - `type: 'user'` 留给 V3 Cloud 的 per-user JWT
 *
 * `id` 在 V1 ApiKey 模式下是固定值（`agent` 或 dev 模式的 `dev`）。V3
 * 起 `id === userId`，用于 vault 路径隔离 / 配额计算。
 */
export interface Principal {
  type: "user" | "service";
  id: string;
}

export interface AuthError {
  code: "unauthorized";
  message: string;
}

/**
 * Strategy 校验结果（tagged union）— `ok: true` 时带 principal，
 * `ok: false` 时带 AuthError。
 *
 * Fastify auth plugin 拿到 `ok: false` 会抛 `UnauthorizedError`，由
 * global error handler 转成统一错误信封。
 */
export type AuthResult =
  | {
      ok: true;
      principal: Principal;
    }
  | {
      ok: false;
      error: AuthError;
    };

export interface AuthStrategy {
  authenticate(req: FastifyRequest): Promise<AuthResult>;
}
