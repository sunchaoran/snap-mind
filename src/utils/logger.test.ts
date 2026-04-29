import pino from "pino";
import { describe, expect, it } from "vitest";
import { getLoggerOptions, REDACT_PATHS } from "./logger.js";

/**
 * Build a pino logger that captures every JSON line into an array, using
 * the same options shape we ship to Fastify. This bypasses pino-pretty
 * (which gets disabled outside dev) so we can assert on raw JSON output.
 */
function makeCapturingLogger() {
  const lines: string[] = [];
  const opts = getLoggerOptions();
  // Strip transport so we get raw JSON via a custom write-stream.
  const { transport: _transport, ...restOpts } = opts;
  const stream = {
    write(chunk: string) {
      lines.push(chunk);
    },
  };
  const logger = pino(
    {
      ...restOpts,
      level: "debug",
    },
    stream,
  );
  return {
    logger,
    lines,
  };
}

describe("logger redaction", () => {
  it("redacts headers.authorization in flat objects (child-logger style)", () => {
    const { logger, lines } = makeCapturingLogger();
    logger.info(
      {
        headers: {
          authorization: "Bearer sk-snapmind-secret",
        },
      },
      "test",
    );

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as {
      headers: {
        authorization: string;
      };
    };
    expect(parsed.headers.authorization).toBe("[Redacted]");
    expect(lines[0]).not.toContain("sk-snapmind-secret");
  });

  it("redacts req.headers.authorization (Fastify auto-serialised)", () => {
    const { logger, lines } = makeCapturingLogger();
    logger.info(
      {
        req: {
          headers: {
            authorization: "Bearer sk-snapmind-secret",
            "content-type": "image/png",
          },
        },
      },
      "request",
    );

    const parsed = JSON.parse(lines[0]) as {
      req: {
        headers: Record<string, string>;
      };
    };
    expect(parsed.req.headers.authorization).toBe("[Redacted]");
    // non-secret fields must remain intact
    expect(parsed.req.headers["content-type"]).toBe("image/png");
    expect(lines[0]).not.toContain("sk-snapmind-secret");
  });

  it("redacts cookies and set-cookie", () => {
    const { logger, lines } = makeCapturingLogger();
    logger.info(
      {
        req: {
          headers: {
            cookie: "session=abc123",
          },
        },
        res: {
          headers: {
            "set-cookie": "session=xyz789",
          },
        },
      },
      "session",
    );

    const parsed = JSON.parse(lines[0]) as {
      req: {
        headers: {
          cookie: string;
        };
      };
      res: {
        headers: {
          "set-cookie": string;
        };
      };
    };
    expect(parsed.req.headers.cookie).toBe("[Redacted]");
    expect(parsed.res.headers["set-cookie"]).toBe("[Redacted]");
    expect(lines[0]).not.toContain("abc123");
    expect(lines[0]).not.toContain("xyz789");
  });

  it("exposes the canonical redact path list", () => {
    expect(REDACT_PATHS).toContain("req.headers.authorization");
    expect(REDACT_PATHS).toContain("headers.authorization");
    expect(REDACT_PATHS).toContain('res.headers["set-cookie"]');
  });
});
