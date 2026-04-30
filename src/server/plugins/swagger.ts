import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import pkg from "../../../package.json" with { type: "json" };

/**
 * OpenAPI / Swagger UI plugin。
 *
 * 注册顺序很重要：必须在 routes **之前** 注册，否则 `@fastify/swagger`
 * 的 `onRoute` hook 收不到后续注册的路由。参见
 * `docs/architecture/api-design.md` §6"启动时的 plugin 顺序"。
 *
 * Routes:
 * - `GET /api/docs`        Swagger UI HTML
 * - `GET /api/docs/json`   OpenAPI 3.x JSON spec
 * - `GET /api/docs/yaml`   同上 YAML
 * - `GET /api/docs/static/*`  Swagger UI 的静态资源
 *
 * 上述路径在 `auth` plugin 的 `skipPaths` 里被全部豁免（`src/index.ts`
 * 注册时显式传入扩展后的列表）。OpenAPI 层面也通过 `security: []`
 * 在路由 schema 上声明 no-auth，方便 spec 消费方理解。
 */
async function swaggerPlugin(app: FastifyInstance): Promise<void> {
  // Register shared schemas via Fastify's addSchema so that route schemas can
  // reference them with `$ref: "ClipRecordWire#"` and Fastify's AJV /
  // fast-json-stringify can resolve them. `@fastify/swagger` then folds these
  // into `components.schemas` in the generated OpenAPI spec.
  for (const schema of SHARED_SCHEMAS) {
    app.addSchema(schema);
  }

  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "snap-mind",
        version: pkg.version,
        description:
          "self-host backend for snap-mind — 截图即收藏。详见 docs/architecture/api-design.md。",
      },
      servers: [
        {
          url: "http://127.0.0.1:3210",
          description: "Local self-host (default)",
        },
      ],
      tags: [
        {
          name: "clips",
          description: "Clip 写入 / 读取 / 删除",
        },
        {
          name: "jobs",
          description: "异步 job 快照与 SSE 进度流",
        },
        {
          name: "batch",
          description: "批量 job 聚合",
        },
        {
          name: "sticky",
          description: "sticky session 上传（debounced batch）",
        },
        {
          name: "meta",
          description: "存活探测 / 系统元数据",
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            description:
              "V1 API key（`process.env.API_KEY`）。dev 模式下未带 header 自动通过。",
          },
        },
      },
      // 全局默认 — Bearer auth 必填；个别 skip 路径在 route schema 上
      // 用 `security: []` 覆盖。
      security: [
        {
          bearerAuth: [],
        },
      ],
    },
    // Default behavior renumbers schemas as `def-0`, `def-1`, ... in the
    // generated spec, ignoring the `$id` we registered. This restores the
    // human-readable component names so refs resolve to
    // `#/components/schemas/Platform` instead of `#/components/schemas/def-0`.
    refResolver: {
      buildLocalReference: (json, _baseUri, _fragment, i) => {
        const id = json.$id;
        if (typeof id === "string" && id.length > 0) {
          return id;
        }
        return `def-${i}`;
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/api/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
    },
    staticCSP: true,
  });
}

export default fp(swaggerPlugin, {
  name: "snap-mind-swagger",
  fastify: "5.x",
});

// ─── 共享 schema 定义 ─────────────────────────────────────────────────
//
// 手写 JSON Schema 而不是用 typebox/zod 自动生成 — V1 范围内一次性成本，
// wire shape 直接对应 `src/types/wire.ts`，是契约的另一种表达。
// 改 wire 类型时请同步改这里。

const PLATFORM_VALUES = [
  "xiaohongshu",
  "twitter",
  "reddit",
  "weibo",
  "zhihu",
  "weixin",
  "bilibili",
  "douban",
  "hackernews",
  "youtube",
  "medium",
  "substack",
  "unknown",
] as const;

const CONTENT_TYPE_VALUES = [
  "post",
  "article",
  "comment",
  "video",
  "thread",
] as const;

const CATEGORY_VALUES = [
  "tech",
  "design",
  "product",
  "business",
  "finance",
  "science",
  "life",
  "culture",
  "career",
  "other",
] as const;

const ERROR_CODE_VALUES = [
  "unauthorized",
  "forbidden",
  "clip_not_found",
  "job_not_found",
  "batch_not_found",
  "sticky_session_not_found",
  "missing_image",
  "no_images",
  "too_many_images",
  "missing_session_id",
  "sticky_wrong_state",
  "sticky_batch_full",
  "rate_limited",
  "internal_error",
] as const;

const JOB_STATUS_VALUES = [
  "running",
  "done",
  "error",
] as const;
const STEP_STATUS_VALUES = [
  "pending",
  "running",
  "done",
  "skipped",
  "error",
] as const;
const STICKY_STATUS_VALUES = [
  "buffering",
  "processing",
  "done",
] as const;

/**
 * Shared JSON Schema definitions registered via `app.addSchema`.
 * Each `$id` is the component name; routes reference them as
 * `$ref: "<id>#"`. `@fastify/swagger` re-emits them under
 * `components.schemas.<id>`.
 */
const SHARED_SCHEMAS: ReadonlyArray<Record<string, unknown>> = [
  {
    $id: "Platform",
    type: "string",
    enum: PLATFORM_VALUES,
    description: "Source platform identifier",
  },
  {
    $id: "ContentType",
    type: "string",
    enum: CONTENT_TYPE_VALUES,
    description: "Content type tag from VLM",
  },
  {
    $id: "Category",
    type: "string",
    enum: CATEGORY_VALUES,
    description: "Predefined category bucket",
  },
  {
    $id: "ErrorEnvelope",
    type: "object",
    required: [
      "error",
    ],
    properties: {
      error: {
        type: "object",
        required: [
          "code",
          "message",
        ],
        properties: {
          code: {
            type: "string",
            enum: ERROR_CODE_VALUES,
            description: "Stable, snake_case error code",
          },
          message: {
            type: "string",
            description: "Human-readable message; not stable across versions",
          },
          details: {
            description: "Optional context — shape varies by code",
          },
        },
      },
    },
    description:
      "统一错误信封 — 所有非 2xx response。详见 docs/architecture/api-design.md §3。",
  },
  {
    $id: "ClipRecordWire",
    type: "object",
    required: [
      "id",
      "title",
      "platform",
      "author",
      "originalUrl",
      "contentType",
      "contentSummary",
      "tags",
      "category",
      "language",
      "screenshotPath",
      "fetchLevel",
      "sourceConfidence",
      "createdAt",
    ],
    properties: {
      id: {
        type: "string",
      },
      title: {
        type: "string",
      },
      platform: {
        $ref: "Platform#",
      },
      author: {
        type: "string",
      },
      originalUrl: {
        type: [
          "string",
          "null",
        ],
      },
      contentType: {
        $ref: "ContentType#",
      },
      contentSummary: {
        type: "string",
      },
      tags: {
        type: "array",
        items: {
          type: "string",
        },
      },
      category: {
        $ref: "Category#",
      },
      language: {
        type: "string",
      },
      screenshotPath: {
        type: "string",
        description: "vault-relative path",
      },
      fetchLevel: {
        type: "integer",
        enum: [
          1,
          2,
          3,
          4,
        ],
      },
      sourceConfidence: {
        type: "number",
      },
      createdAt: {
        type: "string",
        description: "ISO 8601 timestamp from frontmatter",
      },
    },
    description:
      "List view; lacks `contentFull`. See ClipRecordWireFull for detail.",
  },
  {
    $id: "ClipRecordWireFull",
    type: "object",
    required: [
      "id",
      "title",
      "platform",
      "author",
      "originalUrl",
      "contentType",
      "contentSummary",
      "tags",
      "category",
      "language",
      "screenshotPath",
      "fetchLevel",
      "sourceConfidence",
      "createdAt",
      "contentFull",
    ],
    properties: {
      id: {
        type: "string",
      },
      title: {
        type: "string",
      },
      platform: {
        $ref: "Platform#",
      },
      author: {
        type: "string",
      },
      originalUrl: {
        type: [
          "string",
          "null",
        ],
      },
      contentType: {
        $ref: "ContentType#",
      },
      contentSummary: {
        type: "string",
      },
      tags: {
        type: "array",
        items: {
          type: "string",
        },
      },
      category: {
        $ref: "Category#",
      },
      language: {
        type: "string",
      },
      screenshotPath: {
        type: "string",
      },
      fetchLevel: {
        type: "integer",
        enum: [
          1,
          2,
          3,
          4,
        ],
      },
      sourceConfidence: {
        type: "number",
      },
      createdAt: {
        type: "string",
      },
      contentFull: {
        type: [
          "string",
          "null",
        ],
        description: "Full markdown body of `## 原文` section",
      },
    },
    description: "Detail view extending ClipRecordWire with `contentFull`.",
  },
  {
    $id: "ClipResponse",
    type: "object",
    required: [
      "success",
      "clipId",
      "message",
    ],
    properties: {
      success: {
        type: "boolean",
      },
      clipId: {
        type: "string",
      },
      title: {
        type: "string",
      },
      platform: {
        $ref: "Platform#",
      },
      tags: {
        type: "array",
        items: {
          type: "string",
        },
      },
      category: {
        $ref: "Category#",
      },
      fetchLevel: {
        type: "integer",
        enum: [
          1,
          2,
          3,
          4,
        ],
      },
      vaultPath: {
        type: "string",
        description: "Vault-relative path to the .md file",
      },
      error: {
        type: "string",
      },
      screenshotSaved: {
        type: "boolean",
      },
      message: {
        type: "string",
      },
    },
    description: "job.result shape — also batch.results[] element.",
  },
  {
    $id: "JobStepWire",
    type: "object",
    required: [
      "name",
      "status",
    ],
    properties: {
      name: {
        type: "string",
      },
      status: {
        type: "string",
        enum: STEP_STATUS_VALUES,
      },
      message: {
        type: "string",
      },
    },
  },
  {
    $id: "JobWire",
    type: "object",
    required: [
      "id",
      "clipId",
      "status",
      "steps",
      "currentStep",
      "createdAt",
    ],
    properties: {
      id: {
        type: "string",
      },
      clipId: {
        type: "string",
      },
      status: {
        type: "string",
        enum: JOB_STATUS_VALUES,
      },
      steps: {
        type: "array",
        items: {
          $ref: "JobStepWire#",
        },
      },
      currentStep: {
        type: "integer",
      },
      result: {
        $ref: "ClipResponse#",
      },
      createdAt: {
        type: "integer",
        description: "Unix epoch milliseconds",
      },
    },
  },
  {
    $id: "BatchWire",
    type: "object",
    required: [
      "id",
      "status",
      "jobIds",
      "total",
      "completed",
      "succeeded",
      "failed",
      "results",
      "createdAt",
    ],
    properties: {
      id: {
        type: "string",
      },
      status: {
        type: "string",
        enum: JOB_STATUS_VALUES,
      },
      jobIds: {
        type: "array",
        items: {
          type: "string",
        },
      },
      total: {
        type: "integer",
      },
      completed: {
        type: "integer",
      },
      succeeded: {
        type: "integer",
      },
      failed: {
        type: "integer",
      },
      results: {
        type: "array",
        items: {
          $ref: "ClipResponse#",
        },
      },
      createdAt: {
        type: "integer",
        description: "Unix epoch milliseconds",
      },
    },
  },
  {
    $id: "StickyWire",
    type: "object",
    required: [
      "sessionId",
      "status",
      "queueDepth",
      "total",
      "completed",
      "succeeded",
      "failed",
      "results",
    ],
    properties: {
      sessionId: {
        type: "string",
      },
      status: {
        type: "string",
        enum: STICKY_STATUS_VALUES,
      },
      queueDepth: {
        type: "integer",
      },
      batchId: {
        type: [
          "string",
          "null",
        ],
        description:
          "Set after the session leaves `buffering`; null/absent during buffering.",
      },
      total: {
        type: "integer",
      },
      completed: {
        type: "integer",
      },
      succeeded: {
        type: "integer",
      },
      failed: {
        type: "integer",
      },
      results: {
        type: "array",
        items: {
          $ref: "ClipResponse#",
        },
      },
    },
  },
];
