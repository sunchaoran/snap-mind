// Shebang for the built dist/cli.js is injected by tsup.config.ts.
// Don't add one here — running this source via `tsx` doesn't need it,
// and a duplicate would break the compiled file.
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs, styleText } from "node:util";

const VERSION = "0.0.1";

const EXIT = {
  ok: 0,
  generic: 1,
  invalid_input: 2,
  auth: 3,
  network: 4,
  timeout: 5,
  not_found: 6,
  rejected: 7,
  server: 8,
} as const;

type ExitCode = (typeof EXIT)[keyof typeof EXIT];

interface CommonOpts {
  sessionId: string;
  baseUrl: string;
  apiKey: string;
  pollInterval: number;
  timeout: number;
  verbose: boolean;
}

interface PushOpts extends CommonOpts {
  files: string[];
}

interface StickySnapshot {
  sessionId: string;
  status: "buffering" | "processing" | "done";
  queueDepth: number;
  batchId?: string;
  total?: number;
  completed?: number;
  succeeded?: number;
  failed?: number;
  results?: unknown[];
}

function bail(code: ExitCode, message: string, detail?: unknown): never {
  const payload = {
    code,
    message,
    ...(detail !== undefined && {
      detail: detail instanceof Error ? detail.message : String(detail),
    }),
  };
  process.stderr.write(`${styleText("red", "ERROR")}: ${message}\n`);
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exit(code);
}

function vlog(verbose: boolean, ...args: unknown[]): void {
  if (verbose) {
    process.stderr.write(
      `${styleText("dim", "[snap-mind]")} ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}\n`,
    );
  }
}

function dumpEnvelopeForDebug(verbose: boolean): void {
  if (!verbose) {
    return;
  }
  // Debug aid for Q3 — dump env vars OpenClaw runtime *might* inject so
  // we can discover the actual conversation/session/chat field names by
  // looking at the log when the skill runs.
  const interesting = Object.entries(process.env)
    .filter(([key]) =>
      /^(OPENCLAW_|CLAW_|CHANNEL_|MESSAGE_|CHAT_|SESSION_|FROM_|CONTEXT_|WEIXIN_|WX_)/i.test(
        key,
      ),
    )
    .map(([key, value]) => [key, value?.slice(0, 80) ?? null]);
  vlog(verbose, "envelope-env-scan:", JSON.stringify(Object.fromEntries(interesting)));
}

interface ParsedCommand {
  sub: "push" | "wait" | "status";
  opts: CommonOpts | PushOpts;
}

function parse(): ParsedCommand {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      "session-id": {
        type: "string",
      },
      file: {
        type: "string",
        multiple: true,
      },
      "base-url": {
        type: "string",
      },
      "api-key": {
        type: "string",
      },
      "poll-interval": {
        type: "string",
      },
      timeout: {
        type: "string",
      },
      verbose: {
        type: "boolean",
        short: "v",
      },
      version: {
        type: "boolean",
      },
      help: {
        type: "boolean",
        short: "h",
      },
    },
  });

  if (values.version) {
    process.stdout.write(`snap-mind-cli v${VERSION}\n`);
    process.exit(EXIT.ok);
  }
  if (values.help) {
    printHelp();
    process.exit(EXIT.ok);
  }

  const [group, sub] = positionals;
  if (group !== "sticky" || !sub || !["push", "wait", "status"].includes(sub)) {
    printHelp();
    bail(
      EXIT.invalid_input,
      "Usage: snap-mind sticky <push|wait|status> [options]",
    );
  }

  const sessionId = values["session-id"]?.trim();
  if (!sessionId) {
    bail(EXIT.invalid_input, "Missing required --session-id");
  }

  const baseUrl = (
    values["base-url"] ??
    process.env.SNAP_MIND_BASE_URL ??
    "http://localhost:3210"
  ).replace(/\/$/, "");
  const apiKey = values["api-key"] ?? process.env.SNAP_MIND_API_KEY ?? "";
  if (!apiKey) {
    bail(
      EXIT.auth,
      "Missing API key. Set SNAP_MIND_API_KEY env or pass --api-key",
    );
  }

  const common: CommonOpts = {
    sessionId,
    baseUrl,
    apiKey,
    pollInterval: Number(values["poll-interval"]) || 2000,
    timeout: Number(values.timeout) || 600_000,
    verbose: !!values.verbose,
  };

  if (sub === "push") {
    const files = values.file ?? [];
    if (files.length === 0) {
      bail(EXIT.invalid_input, "Push requires at least one --file");
    }
    return {
      sub,
      opts: {
        ...common,
        files,
      },
    };
  }

  return {
    sub: sub as "wait" | "status",
    opts: common,
  };
}

async function pushCommand(opts: PushOpts): Promise<void> {
  let lastSnapshot: StickySnapshot | null = null;

  for (const file of opts.files) {
    if (!existsSync(file)) {
      bail(EXIT.invalid_input, `File not found: ${file}`);
    }
    const buffer = readFileSync(file);
    const filename = basename(file);
    vlog(
      opts.verbose,
      `pushing ${filename} (${buffer.length}B) → ${opts.baseUrl}/api/v1/clip/sticky?sessionId=${opts.sessionId}`,
    );

    const form = new FormData();
    form.append(
      "image",
      new Blob([new Uint8Array(buffer)]),
      filename,
    );

    const url = `${opts.baseUrl}/api/v1/clip/sticky?sessionId=${encodeURIComponent(opts.sessionId)}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
        },
        body: form,
      });
    } catch (err) {
      return bail(EXIT.network, `Cannot reach ${opts.baseUrl}`, err);
    }

    await ensureOk(res, opts);
    lastSnapshot = (await res.json()) as StickySnapshot;
    vlog(opts.verbose, "←", lastSnapshot);
  }

  process.stdout.write(`${JSON.stringify(lastSnapshot)}\n`);
}

async function statusCommand(opts: CommonOpts): Promise<void> {
  const snapshot = await fetchStatus(opts);
  process.stdout.write(`${JSON.stringify(snapshot)}\n`);
}

async function waitCommand(opts: CommonOpts): Promise<void> {
  const start = Date.now();
  while (true) {
    if (Date.now() - start > opts.timeout) {
      bail(EXIT.timeout, `Timed out after ${opts.timeout}ms`);
    }
    const snapshot = await fetchStatus(opts);
    vlog(
      opts.verbose,
      `status=${snapshot.status} ${snapshot.completed ?? 0}/${snapshot.total ?? snapshot.queueDepth}`,
    );
    if (snapshot.status === "done") {
      process.stdout.write(`${JSON.stringify(snapshot)}\n`);
      return;
    }
    await sleep(opts.pollInterval);
  }
}

async function fetchStatus(opts: CommonOpts): Promise<StickySnapshot> {
  const url = `${opts.baseUrl}/api/v1/clip/sticky/${encodeURIComponent(opts.sessionId)}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    return bail(EXIT.network, `Cannot reach ${opts.baseUrl}`, err);
  }
  await ensureOk(res, opts);
  return (await res.json()) as StickySnapshot;
}

async function ensureOk(res: Response, opts: CommonOpts): Promise<void> {
  if (res.ok) {
    return;
  }
  const body = await res.text().catch(() => "");
  if (res.status === 401) {
    bail(EXIT.auth, "Authentication failed (401). Check SNAP_MIND_API_KEY.", body);
  }
  if (res.status === 404) {
    bail(EXIT.not_found, `Not found at ${res.url}`, body);
  }
  if (res.status >= 500) {
    bail(EXIT.server, `Server error ${res.status}`, body);
  }
  bail(EXIT.rejected, `Server rejected request: ${res.status}`, body);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function printHelp(): void {
  process.stdout.write(`snap-mind-cli v${VERSION} — sticky upload helper for SnapMind

Usage:
  snap-mind sticky push   --session-id <id> --file <path> [--file <path>...]
  snap-mind sticky wait   --session-id <id> [--poll-interval <ms>] [--timeout <ms>]
  snap-mind sticky status --session-id <id>

Common options:
  --base-url <url>     Override SNAP_MIND_BASE_URL (default http://localhost:3210)
  --api-key <token>    Override SNAP_MIND_API_KEY
  --verbose, -v        Log to stderr
  --version
  --help, -h

Environment:
  SNAP_MIND_BASE_URL   default http://localhost:3210
  SNAP_MIND_API_KEY    required (Bearer token)

Exit codes:
  0 ok
  1 generic
  2 invalid input
  3 auth (401)
  4 network (cannot reach server)
  5 wait timeout
  6 not found (404)
  7 rejected (4xx other)
  8 server error (5xx)
`);
}

const { sub, opts } = parse();
vlog(
  opts.verbose,
  `command=${sub} session=${opts.sessionId} baseUrl=${opts.baseUrl}`,
);
dumpEnvelopeForDebug(opts.verbose);

if (sub === "push") {
  await pushCommand(opts as PushOpts);
} else if (sub === "wait") {
  await waitCommand(opts);
} else {
  await statusCommand(opts);
}
