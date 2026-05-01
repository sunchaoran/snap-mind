import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import pkg from "../../../package.json" with { type: "json" };

/**
 * OpenAPI / Swagger UI plugin。
 *
 * 注册顺序很重要：必须在 routes **之前** 注册，否则 `@fastify/swagger`
 * 的 `onRoute` hook 收不到后续注册的路由。也必须在 `shared-schemas`
 * **之后**，否则 OpenAPI 输出里的 `components.schemas` 会缺失。参见
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
