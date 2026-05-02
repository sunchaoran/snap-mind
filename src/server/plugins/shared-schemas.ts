import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

/**
 * Shared JSON Schema definitions, registered via `app.addSchema` so that
 * route schemas can reference them with `$ref: "<id>#"` and Fastify's AJV /
 * fast-json-stringify can resolve them.
 *
 * Decoupled from the Swagger plugin on purpose: schemas are part of the
 * route serialization contract regardless of whether the OpenAPI / Swagger
 * UI surface is mounted (e.g. test harnesses skip swagger but still need
 * routes to compile their response schemas). `@fastify/swagger` discovers
 * registered schemas via `app.getSchemas()` and folds them into
 * `components.schemas.<id>` automatically — no explicit handoff needed.
 *
 * Registration order: this plugin must be registered **before** any plugin
 * that registers routes referencing these `$id`s (notably the swagger
 * plugin itself, which registers `/api/docs/*` routes).
 *
 * Hand-written JSON Schema rather than typebox/zod-derived — V1-scope
 * one-time cost. Wire shape mirrors `src/types/wire.ts`; treat both as
 * sources of truth for the public contract and update together.
 */
async function sharedSchemasPlugin(app: FastifyInstance): Promise<void> {
  for (const schema of SHARED_SCHEMAS) {
    app.addSchema(schema);
  }
}

export default fp(sharedSchemasPlugin, {
  name: "snap-mind-shared-schemas",
  fastify: "5.x",
});

// ─── 共享 schema 定义 ─────────────────────────────────────────────────

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
      "aiTitle",
      "originalTitle",
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
        description:
          "Primary display title — equals aiTitle for new clips, original VLM title for legacy clips. Always present.",
      },
      aiTitle: {
        type: [
          "string",
          "null",
        ],
        description:
          "LLM-rewritten objective title. null for legacy clips and failure placeholders.",
      },
      originalTitle: {
        type: "string",
        description:
          "Raw VLM-extracted title (potentially clickbait). For legacy clips, falls back to the legacy `title` field.",
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
      "aiTitle",
      "originalTitle",
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
        description:
          "Primary display title — equals aiTitle for new clips, original VLM title for legacy clips. Always present.",
      },
      aiTitle: {
        type: [
          "string",
          "null",
        ],
        description:
          "LLM-rewritten objective title. null for legacy clips and failure placeholders.",
      },
      originalTitle: {
        type: "string",
        description:
          "Raw VLM-extracted title (potentially clickbait). For legacy clips, falls back to the legacy `title` field.",
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
