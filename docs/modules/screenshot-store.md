# 模块：ScreenshotStore

> 管理截图文件的存储，支持自动格式检测和图片预处理（压缩）。

## 源文件

- `src/store/screenshot.ts` — 文件存储
- `src/utils/image.ts` — 图片预处理（sharp）

## 函数

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

- 自动创建 `{VAULT_PATH}/snap-mind/assets/` 目录
- `ext` 参数可选，未提供时通过 `detectImageExt()` 自动检测
- 返回 vault 相对路径（如 `assets/clip_20260402_143000_V1StGX.png`）

### saveSidecarJson(clipId, data)

```typescript
async function saveSidecarJson(clipId: string, data: unknown): Promise<void>
```

与截图同目录，存储 VLM 原始结果（`MergedVLMResult`）用于 debug。

### preprocessImage(imageBuffer)

```typescript
async function preprocessImage(imageBuffer: Buffer): Promise<PreprocessedImage>

interface PreprocessedImage {
  buffer: Buffer;         // 压缩后的 WebP 图片
  ext: "webp";
  originalSize: number;   // 原始大小（bytes）
  compressedSize: number; // 压缩后大小（bytes）
}
```

在 Pipeline 入口处调用，VLM 分析和截图存储均使用压缩后的图片：
- **缩放**：最长边超过 2560px 时等比缩放（不放大小图）
- **格式转换**：统一转为 WebP（lossy, quality 80）
- **依赖**：[sharp](https://sharp.pixelplumbing.com/)（基于 libvips，高性能）

### 存储路径

```
{VAULT_PATH}/snap-mind/assets/clip_20260402_143000_V1StGX.webp  # 截图（压缩后）
{VAULT_PATH}/snap-mind/assets/clip_20260402_143000_V1StGX.json  # sidecar
```
