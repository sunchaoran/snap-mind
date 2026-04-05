import type { FastifyRequest } from "fastify";
import type { AuthResult } from "../types/index.js";
import { config } from "../config.js";

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export async function authenticate(
  request: FastifyRequest,
): Promise<AuthResult> {
  const authHeader = request.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing or invalid Authorization header");
  }

  const token = authHeader.slice(7);

  // API Key authentication
  if (token === config.auth.apiKey) {
    return { clientId: "agent", clientType: "agent" };
  }

  // JWT authentication — TODO: implement JWT validation
  // For now, reject non-API-Key tokens
  throw new UnauthorizedError("Invalid token");
}
