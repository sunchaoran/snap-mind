# Module: ScreenshotStore

> 管理截图文件的存储，支持自动格式检测。

## Source Files

- `src/store/screenshot.ts`

## Functions

### detectImageExt(buf)

通过 magic bytes 自动检测图片格式：

| Magic Bytes | Format |
|-------------|--------|
| `89 50` | PNG |
| `FF D8` | JPG |
| `52 49` | WEBP |
| `47 49` | GIF |

默认 fallback: `png`

### saveScreenshot(clipId, imageBuffer, ext?)

```typescript
async function saveScreenshot(
  clipId: string,
  imageBuffer: Buffer,
  ext?: string,  // 可选，不传则自动检测
): Promise<string>  // 返回 vault 相对路径，如 "assets/clip_xxx.png"
```

- 自动创建 `{VAULT_PATH}/Clippings/assets/` 目录
- `ext` 参数可选，未提供时通过 `detectImageExt()` 自动检测
- 返回 vault 相对路径（如 `assets/clip_20260402_143000_V1StGX.png`）

### saveSidecarJson(clipId, data)

```typescript
async function saveSidecarJson(clipId: string, data: unknown): Promise<void>
```

与截图同目录，存储 VLM 原始结果（`MergedVLMResult`）用于 debug。

### Storage Path

```
{VAULT_PATH}/Clippings/assets/clip_20260402_143000_V1StGX.png   # 截图
{VAULT_PATH}/Clippings/assets/clip_20260402_143000_V1StGX.json  # sidecar
```
