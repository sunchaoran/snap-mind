/**
 * Vault 文件结构里的文本字面量。
 *
 * Backend 是这些字符串的"唯一作者"——template.ts 写出来、library/clips.ts
 * 反向解析回去。共用一份常量，避免日后改了一头忘了另一头。
 *
 * 路径相关的可配置项（clippingsDir / assetsDir）仍然在 `config.vault`，
 * 因为那些理论上可被环境变量覆盖；这里放的是协议层面的硬约定。
 */

/** Dataview 索引页文件名，列表/删除时跳过 */
export const VAULT_INDEX_FILENAME = "_index.md";

/** Markdown body 里 backend 写出的三个 H2 段落 heading */
export const HEADING_SUMMARY = "## 摘要";
export const HEADING_ORIGINAL = "## 原文";
export const HEADING_SCREENSHOT = "## 截图";

/** "扫到下一个 H2 就停"用的通用前缀 */
export const H2_PREFIX = "## ";

/**
 * 没有 `![[...]]` embed 时 wire format `screenshotPath` 的 fallback 扩展。
 * 跟 `preprocessImage` 输出格式保持一致 (sharp 默认转 WebP)。
 */
export const FALLBACK_SCREENSHOT_EXT = "webp";
