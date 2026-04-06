import type { FastifyRequest } from "fastify";
import { config } from "@/config.js";
import type { AuthResult } from "@/types/index.js";

export interface UnauthorizedError {
  readonly _tag: "UnauthorizedError";
  readonly message: string;
}

export function unauthorizedError(message = "Unauthorized"): UnauthorizedError {
  return {
    _tag: "UnauthorizedError",
    message,
  };
}

export function isUnauthorizedError(err: unknown): err is UnauthorizedError {
  return (
    typeof err === "object" &&
    err !== null &&
    "_tag" in err &&
    err._tag === "UnauthorizedError"
  );
}

export type AuthenticateResult =
  | {
      ok: true;
      value: AuthResult;
    }
  | {
      ok: false;
      error: UnauthorizedError;
    };

export async function authenticate(
  request: FastifyRequest,
): Promise<AuthenticateResult> {
  // Dev mode: skip auth when no header is provided
  if (process.env.NODE_ENV !== "production" && !request.headers.authorization) {
    return {
      ok: true,
      value: {
        clientId: "dev",
        clientType: "agent",
      },
    };
  }

  const authHeader = request.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return {
      ok: false,
      error: unauthorizedError("Missing or invalid Authorization header"),
    };
  }

  const token = authHeader.slice(7);

  // API Key authentication
  if (token === config.auth.apiKey) {
    return {
      ok: true,
      value: {
        clientId: "agent",
        clientType: "agent",
      },
    };
  }

  // JWT authentication — TODO: implement JWT validation
  // For now, reject non-API-Key tokens
  return {
    ok: false,
    error: unauthorizedError("Invalid token"),
  };
}
