/**
 * Unified image type detection from raw buffer magic bytes.
 * Consolidates logic previously duplicated in analyzer.ts and screenshot.ts.
 */
export interface ImageType {
  mime: string;
  ext: string;
}

const SIGNATURES: {
  bytes: number[];
  mime: string;
  ext: string;
}[] = [
  {
    bytes: [
      0x89,
      0x50,
    ],
    mime: "image/png",
    ext: "png",
  },
  {
    bytes: [
      0xff,
      0xd8,
    ],
    mime: "image/jpeg",
    ext: "jpg",
  },
  {
    bytes: [
      0x52,
      0x49,
    ],
    mime: "image/webp",
    ext: "webp",
  },
  {
    bytes: [
      0x47,
      0x49,
    ],
    mime: "image/gif",
    ext: "gif",
  },
];

export function detectImageType(buf: Buffer): ImageType {
  for (const sig of SIGNATURES) {
    if (sig.bytes.every((b, i) => buf[i] === b)) {
      return {
        mime: sig.mime,
        ext: sig.ext,
      };
    }
  }
  return {
    mime: "image/png",
    ext: "png",
  };
}
