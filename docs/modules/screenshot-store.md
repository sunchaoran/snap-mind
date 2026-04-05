# Module: ScreenshotStore

> 管理截图文件的存储。

## Source Files

- `src/store/screenshot.ts`

## Interface

```typescript
interface ScreenshotStore {
  /** 保存截图到 vault assets 目录，返回相对路径 */
  save(clipId: string, imageBuffer: Buffer, ext: string): Promise<string>;
}
```

## Implementation

将截图从临时目录复制到 `{VAULT_PATH}/Clippings/assets/{clipId}.{ext}`。

### Storage Path

```
{VAULT_PATH}/Clippings/assets/clip_20260402_143000_a3f2.png
```

### Sidecar JSON

与截图同目录，存储 `rawVlmResult` 用于 debug：

```
{VAULT_PATH}/Clippings/assets/clip_20260402_143000_a3f2.json
```
