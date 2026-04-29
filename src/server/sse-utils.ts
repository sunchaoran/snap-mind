/**
 * SSE (Server-Sent Events) 小工具 — 让 jobs / batch routes 写帧时不重复样板。
 *
 * SSE 帧格式（W3C EventSource）：
 * ```
 * event: <eventName>\n
 * data: <single-line JSON>\n
 * \n              ← 空行 = 帧结束
 * ```
 *
 * `data` 必须是单行；这里假设传入 `data` 不含字面量换行（JSON.stringify
 * 默认不输出未转义换行，所以安全）。
 */
export function sendEvent(
  stream: NodeJS.WritableStream,
  eventName: string,
  data: unknown,
): void {
  stream.write(`event: ${eventName}\n`);
  stream.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * 写 SSE response header — 必须用 `reply.raw.writeHead` 写，不能走
 * `reply.headers()` / `reply.send()`，否则会触发 Fastify 的 send 流水线
 * 把响应当成普通 JSON 发出去，破坏 stream 语义。
 */
export function writeSseHead(stream: import("node:http").ServerResponse): void {
  stream.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-store",
    Connection: "keep-alive",
    // 防止上游反向代理（nginx / Tailscale Serve 等）把 stream buffer 起来。
    "X-Accel-Buffering": "no",
  });
}
