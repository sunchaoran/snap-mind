// Set dummy env BEFORE any project imports.
//
// Some project modules (e.g. src/vlm/llm-client.ts) construct API clients
// eagerly at module load. ESM hoists static imports above all top-level
// statements, so anything that touches the project graph is wrapped in a
// dynamic `import()` inside `main()` — those run after this assignment.
//
// The dummy values are never sent anywhere; spec generation does no I/O.
process.env.OPENROUTER_API_KEY ??= "dummy-spec-gen";
process.env.API_KEY ??= "dummy-spec-gen";

import { readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { styleText } from "node:util";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const OUT_PATH = resolve(REPO_ROOT, "docs/api/reference.md");
const CHECK_MODE = process.argv.includes("--check");

// ─── OpenAPI 3.1 minimal types ───────────────────────────────────────────
//
// Only the fields we actually consume — not a full OpenAPI typing.

interface Spec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers?: Array<{
    url: string;
    description?: string;
  }>;
  tags?: Array<{
    name: string;
    description?: string;
  }>;
  components?: {
    securitySchemes?: Record<string, unknown>;
    schemas?: Record<string, SchemaObject>;
  };
  paths: Record<string, PathItem>;
}

type PathItem = Partial<Record<HttpMethod, Operation>>;
type HttpMethod = "get" | "post" | "put" | "delete" | "patch";

interface Operation {
  tags?: string[];
  summary?: string;
  description?: string;
  security?: Array<Record<string, string[]>>;
  parameters?: Parameter[];
  requestBody?: {
    description?: string;
    content?: Record<
      string,
      {
        schema?: SchemaObject;
      }
    >;
  };
  responses?: Record<string, ResponseObject>;
}

interface Parameter {
  name: string;
  in: "query" | "path" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: SchemaObject;
}

interface ResponseObject {
  description?: string;
  content?: Record<
    string,
    {
      schema?: SchemaObject;
    }
  >;
}

interface SchemaObject {
  type?: string | string[];
  enum?: unknown[];
  $ref?: string;
  items?: SchemaObject;
  properties?: Record<string, SchemaObject>;
  required?: string[];
  description?: string;
  title?: string;
}

// ─── Spec acquisition ────────────────────────────────────────────────────

async function buildSpec(): Promise<Spec> {
  // Dynamic imports — env is set, project graph safe to load now.
  const { default: Fastify } = await import("fastify");
  const { default: swaggerPlugin } = await import(
    "@/server/plugins/swagger.js"
  );
  const { registerRoutes } = await import("@/server/routes/index.js");

  const app = Fastify({
    logger: false,
  });
  await app.register(swaggerPlugin);
  await registerRoutes(app);
  await app.ready();
  const spec = app.swagger() as unknown as Spec;
  await app.close();
  return spec;
}

// ─── Markdown rendering ──────────────────────────────────────────────────

const HTTP_METHOD_ORDER: HttpMethod[] = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
];

function render(spec: Spec): string {
  const out: string[] = [];

  // Header
  out.push(`# SnapMind HTTP API Reference`);
  out.push("");
  out.push(`> **Auto-generated** from the OpenAPI 3.1 spec by`);
  out.push(`> \`pnpm gen:api-doc\`. **Do not edit by hand** — your changes`);
  out.push(`> will be overwritten on next regeneration.`);
  out.push(`>`);
  out.push(`> Source of truth:`);
  out.push(
    `> - Shared schemas: [\`src/server/plugins/swagger.ts\`](../../src/server/plugins/swagger.ts)`,
  );
  out.push(
    `> - Per-route annotations: [\`src/server/routes/\`](../../src/server/routes)`,
  );
  out.push("");
  out.push(`- **Version**: \`${spec.info.version}\``);
  if (spec.servers && spec.servers.length > 0) {
    out.push(`- **Base URL**: \`${spec.servers[0].url}\``);
  }
  out.push(
    `- **Auth**: \`Authorization: Bearer <API_KEY>\` (V1 ApiKeyStrategy)`,
  );
  out.push(
    `- **Interactive UI**: \`/api/docs\` (Swagger UI, served by backend)`,
  );
  out.push(
    `- **Design doc**: [api-design.md](../architecture/api-design.md) — authoritative契约和决策`,
  );
  out.push("");
  if (spec.info.description) {
    out.push(spec.info.description);
    out.push("");
  }
  out.push("---");
  out.push("");

  // Endpoints, grouped by tag (preserve tag order from spec.tags)
  out.push(`## Endpoints`);
  out.push("");
  const tagOrder = spec.tags?.map((t) => t.name) ?? [];
  const grouped = groupByTag(spec.paths, tagOrder);
  for (const tag of tagOrder) {
    const group = grouped.get(tag);
    if (!group || group.length === 0) {
      continue;
    }
    const tagMeta = spec.tags?.find((t) => t.name === tag);
    out.push(`### ${tag}`);
    if (tagMeta?.description) {
      out.push("");
      out.push(`> ${tagMeta.description}`);
    }
    out.push("");
    for (const { path, method, op } of group) {
      out.push(...renderEndpoint(path, method, op));
    }
  }

  // Untagged catch-all (in case anything slips)
  const untagged = grouped.get("__untagged__");
  if (untagged && untagged.length > 0) {
    out.push(`### (untagged)`);
    out.push("");
    for (const { path, method, op } of untagged) {
      out.push(...renderEndpoint(path, method, op));
    }
  }

  // Schemas
  out.push("---");
  out.push("");
  out.push(`## Schemas`);
  out.push("");
  const schemas = spec.components?.schemas ?? {};
  const schemaNames = Object.keys(schemas).sort();
  for (const name of schemaNames) {
    out.push(...renderSchema(name, schemas[name]));
  }

  // Trailing newline
  return `${out.join("\n").trimEnd()}\n`;
}

function groupByTag(
  paths: Record<string, PathItem>,
  tagOrder: string[],
): Map<
  string,
  Array<{
    path: string;
    method: HttpMethod;
    op: Operation;
  }>
> {
  const grouped = new Map<
    string,
    Array<{
      path: string;
      method: HttpMethod;
      op: Operation;
    }>
  >();
  for (const tag of tagOrder) {
    grouped.set(tag, []);
  }
  grouped.set("__untagged__", []);

  for (const [path, item] of Object.entries(paths)) {
    for (const method of HTTP_METHOD_ORDER) {
      const op = item[method];
      if (!op) {
        continue;
      }
      const tag = op.tags?.[0] ?? "__untagged__";
      const list = grouped.get(tag) ?? [];
      list.push({
        path,
        method,
        op,
      });
      grouped.set(tag, list);
    }
  }
  return grouped;
}

function renderEndpoint(
  path: string,
  method: HttpMethod,
  op: Operation,
): string[] {
  const out: string[] = [];
  const sigPath = path.replace(/\{(\w+)\}/g, ":$1"); // {id} → :id, friendlier in headings
  out.push(`#### \`${method.toUpperCase()} ${sigPath}\``);
  out.push("");
  if (op.summary) {
    out.push(`> ${op.summary}`);
    out.push("");
  }
  if (op.description) {
    out.push(op.description);
    out.push("");
  }

  // Auth indicator
  const authRequired =
    !op.security || op.security.some((s) => Object.keys(s).length > 0);
  out.push(
    `- **Auth**: ${authRequired ? "required (Bearer)" : "not required"}`,
  );

  // Path / query parameters
  const params = op.parameters ?? [];
  const pathParams = params.filter((p) => p.in === "path");
  const queryParams = params.filter((p) => p.in === "query");

  if (pathParams.length > 0) {
    out.push(`- **Path params**:`);
    for (const p of pathParams) {
      out.push(
        `  - \`${p.name}\`: ${describeSchema(p.schema)}${descSuffix(p.description)}`,
      );
    }
  }
  if (queryParams.length > 0) {
    out.push(`- **Query params**:`);
    for (const p of queryParams) {
      const req = p.required ? " *(required)*" : "";
      out.push(
        `  - \`${p.name}\`${req}: ${describeSchema(p.schema)}${descSuffix(p.description)}`,
      );
    }
  }

  // Request body
  if (op.requestBody) {
    const ct = op.requestBody.content
      ? Object.keys(op.requestBody.content).join(", ")
      : "any";
    out.push(
      `- **Request body**: \`${ct}\`${descSuffix(op.requestBody.description)}`,
    );
  }

  // Responses
  out.push(`- **Responses**:`);
  const responses = op.responses ?? {};
  const statuses = Object.keys(responses).sort();
  for (const status of statuses) {
    const resp = responses[status];
    const bodyDesc = describeResponseBody(resp);
    // Suppress response.description when it was auto-filled by fastify-swagger
    // from the referenced schema (happens whenever the body is just a $ref).
    // The linked schema's own page already carries the description.
    const desc =
      resp.description &&
      resp.description !== "Default Response" &&
      !isJustRef(resp)
        ? ` — ${resp.description}`
        : "";
    out.push(`  - \`${status}\`: ${bodyDesc}${desc}`);
  }
  out.push("");
  out.push("---");
  out.push("");
  return out;
}

function isJustRef(resp: ResponseObject): boolean {
  const json = resp.content?.["application/json"]?.schema;
  return Boolean(json?.$ref && Object.keys(json).length === 1);
}

function describeResponseBody(resp: ResponseObject): string {
  const json = resp.content?.["application/json"]?.schema;
  if (json) {
    return describeSchema(json);
  }
  // SSE / text streams
  const eventStream = resp.content?.["text/event-stream"];
  if (eventStream) {
    return "`text/event-stream` (SSE)";
  }
  // No content (e.g. 204)
  if (!resp.content) {
    return "no body";
  }
  const types = Object.keys(resp.content).join(", ");
  return `\`${types}\``;
}

function describeSchema(s: SchemaObject | undefined): string {
  if (!s) {
    return "any";
  }
  if (s.$ref) {
    const name = refName(s.$ref);
    return `[\`${name}\`](#${anchorize(name)})`;
  }
  if (s.enum) {
    const items = s.enum.map((v) => `\`${String(v)}\``).join(" \\| ");
    return items;
  }
  if (Array.isArray(s.type)) {
    return s.type.map((t) => `\`${t}\``).join(" \\| ");
  }
  if (s.type === "array" && s.items) {
    return `array of ${describeSchema(s.items)}`;
  }
  if (s.type === "object" && s.properties) {
    const keys = Object.keys(s.properties).join(", ");
    return `object \`{ ${keys} }\``;
  }
  if (s.type) {
    return `\`${s.type}\``;
  }
  return "any";
}

function descSuffix(desc: string | undefined): string {
  return desc ? ` — ${desc}` : "";
}

function refName(ref: string): string {
  // "#/components/schemas/Platform" → "Platform"
  const parts = ref.split("/");
  return parts[parts.length - 1];
}

function anchorize(name: string): string {
  // GitHub-flavoured markdown lowercases anchors and strips most punctuation.
  return name.toLowerCase();
}

function renderSchema(name: string, s: SchemaObject): string[] {
  const out: string[] = [];
  out.push(`### \`${name}\``);
  if (s.description) {
    out.push("");
    out.push(`> ${s.description.replace(/\n/g, " ")}`);
  }
  out.push("");

  if (s.enum) {
    out.push(
      `**Enum** (\`${Array.isArray(s.type) ? s.type.join("|") : (s.type ?? "string")}\`):`,
    );
    out.push("");
    out.push(s.enum.map((v) => `\`${String(v)}\``).join(" · "));
    out.push("");
  } else if (s.type === "object" && s.properties) {
    const required = new Set(s.required ?? []);
    out.push(`| Field | Type | Required | Notes |`);
    out.push(`|---|---|---|---|`);
    for (const [field, propSchema] of Object.entries(s.properties)) {
      const typeCell = describeSchema(propSchema);
      const reqCell = required.has(field) ? "✓" : "—";
      const notes = propSchema.description
        ? propSchema.description.replace(/\|/g, "\\|").replace(/\n/g, " ")
        : "";
      out.push(`| \`${field}\` | ${typeCell} | ${reqCell} | ${notes} |`);
    }
    out.push("");
  } else if (s.type) {
    const t = Array.isArray(s.type) ? s.type.join(" \\| ") : s.type;
    out.push(`Type: \`${t}\``);
    out.push("");
  }

  out.push("---");
  out.push("");
  return out;
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  const spec = await buildSpec();
  const markdown = render(spec);
  const rel = relative(REPO_ROOT, OUT_PATH);

  if (CHECK_MODE) {
    let current = "";
    try {
      current = await readFile(OUT_PATH, "utf-8");
    } catch {
      // Missing file is treated as drift (will be reported below).
    }
    if (current === markdown) {
      console.log(
        styleText("green", `[gen:api-doc] ${rel} is in sync with the spec`),
      );
      return;
    }
    console.error(styleText("red", `[gen:api-doc] DRIFT detected`));
    console.error(`  ${rel} is out of sync with the OpenAPI spec.`);
    console.error(`  Run \`pnpm gen:api-doc\` and stage the result.`);
    process.exit(1);
  }

  await writeFile(OUT_PATH, markdown, "utf-8");
  console.log(styleText("green", `[gen:api-doc] wrote ${rel}`));
}

await main();
