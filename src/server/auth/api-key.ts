import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { config } from "@/config.js";
import type { AuthResult, AuthStrategy } from "@/server/auth/strategy.js";

const BEARER_PREFIX = "Bearer ";

/**
 * V1 API Key strategy。
 *
 * 校验流程:
 * 1. 缺 Authorization header 时：
 *    - dev 模式（NODE_ENV !== 'production'）→ ok，principal 为 dev service
 *    - production 模式 → 401
 * 2. 有 header 但不是 `Bearer ` 开头 → 401
 * 3. 用 `node:crypto.timingSafeEqual` 跟 `config.auth.apiKey` 比对 token，
 *    成功返回 `agent` service principal
 *
 * timingSafeEqual 要求两个 Buffer 等长。长度不等时直接 reject — 不要
 * pad 到等长再比，因为长度差本身就是泄漏，pad 之后还得做一次内存分配
 * 和拷贝；对于"不匹配长度"这种 enumerable 状态，常量时间不能消除，但
 * 能避免提供给攻击者更细粒度的探测能力（和 Buffer.compare 等价）。
 */
export class ApiKeyStrategy implements AuthStrategy {
  private readonly expectedToken: string;

  constructor(token: string = config.auth.apiKey) {
    this.expectedToken = token ?? "";
  }

  async authenticate(req: FastifyRequest): Promise<AuthResult> {
    const isProduction = process.env.NODE_ENV === "production";
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      if (!isProduction) {
        return {
          ok: true,
          principal: {
            type: "service",
            id: "dev",
          },
        };
      }
      return {
        ok: false,
        error: {
          code: "unauthorized",
          message: "Missing Authorization header",
        },
      };
    }

    if (!authHeader.startsWith(BEARER_PREFIX)) {
      return {
        ok: false,
        error: {
          code: "unauthorized",
          message: "Authorization header must use Bearer scheme",
        },
      };
    }

    const provided = authHeader.slice(BEARER_PREFIX.length);
    if (!this.constantTimeEquals(provided, this.expectedToken)) {
      return {
        ok: false,
        error: {
          code: "unauthorized",
          message: "Invalid token",
        },
      };
    }

    return {
      ok: true,
      principal: {
        type: "service",
        id: "agent",
      },
    };
  }

  private constantTimeEquals(a: string, b: string): boolean {
    if (!a || !b) {
      return false;
    }
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) {
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  }
}
