/**
 * HTTP 层错误文案集中处。
 *
 * - 客户端会按字段做日志/告警匹配，文案稳定下来更友好
 * - 集中后改文案、加 i18n、做错误码映射都是一处的事
 *
 * Auth 相关错误仍由 `auth.ts` 自己产出（带类型化 tag），不在这里重复。
 */

export const ERR_CLIP_NOT_FOUND = "Clip not found";
export const ERR_BATCH_NOT_FOUND = "Batch not found";
export const ERR_JOB_NOT_FOUND = "Job not found";

export const ERR_MISSING_IMAGE = "Missing image file";
export const ERR_NO_IMAGES = "No image files provided";

export function errTooManyImages(max: number): string {
  return `Too many images. Max ${max} per batch`;
}
