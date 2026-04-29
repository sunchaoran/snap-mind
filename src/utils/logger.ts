import pino, { type LoggerOptions } from "pino";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Paths redacted by pino in every logger created via {@link getLoggerOptions}.
 *
 * Covers Fastify request/response auto-serialised fields (`req.headers.*`,
 * `res.headers.*`) plus the simplified path used by child loggers that log
 * a flat `{ headers }` object directly.
 *
 * Note: pino's redact does NOT support arbitrary glob patterns (no `*.apiKey`
 * style). To prevent secrets in `config.*.apiKey` etc. from leaking, callers
 * must avoid logging the whole `config` object — log specific non-secret
 * fields instead.
 */
export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["set-cookie"]',
  "res.headers.authorization",
  'res.headers["set-cookie"]',
  "headers.authorization",
  "headers.cookie",
  'headers["set-cookie"]',
] as const;

/**
 * Returns shared pino options used by both Fastify's built-in logger
 * (in `src/index.ts`) and the standalone root logger below.
 *
 * Keeping this in one place ensures level / transport / redact stay in sync.
 */
export function getLoggerOptions(): LoggerOptions {
  return {
    level: isDev ? "debug" : "info",
    redact: {
      paths: [
        ...REDACT_PATHS,
      ],
      censor: "[Redacted]",
      remove: false,
    },
    ...(isDev && {
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss",
          ignore: "pid,hostname",
        },
      },
    }),
  };
}

const rootLogger = pino(getLoggerOptions());

export function createLogger(module: string) {
  return rootLogger.child({
    module,
  });
}

export function errMsg(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
