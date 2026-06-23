import { inflateSync } from "node:zlib";

export function hasExpectedImageSignature(bytes: Buffer, mimeType: string, maxBytes = 16 * 1024 * 1024) {
  if (mimeType === "image/jpeg") {
    return (
      bytes.length >= 4 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff &&
      bytes[bytes.length - 2] === 0xff &&
      bytes[bytes.length - 1] === 0xd9
    );
  }
  if (mimeType === "image/png") {
    return isStructurallyValidPng(bytes, maxBytes);
  }
  if (mimeType === "image/webp") {
    return isStructurallyValidWebp(bytes);
  }
  return false;
}

function isStructurallyValidWebp(bytes: Buffer) {
  if (bytes.length < 16) return false;
  if (bytes.subarray(0, 4).toString("ascii") !== "RIFF") return false;
  if (bytes.subarray(8, 12).toString("ascii") !== "WEBP") return false;
  const declaredSize = bytes.readUInt32LE(4) + 8;
  if (declaredSize !== bytes.length) return false;
  const chunkType = bytes.subarray(12, 16).toString("ascii");
  return chunkType === "VP8 " || chunkType === "VP8L" || chunkType === "VP8X";
}

function isStructurallyValidPng(bytes: Buffer, maxBytes: number) {
  if (
    bytes.length < 33 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47 ||
    bytes[4] !== 0x0d ||
    bytes[5] !== 0x0a ||
    bytes[6] !== 0x1a ||
    bytes[7] !== 0x0a
  ) {
    return false;
  }

  let offset = 8;
  let seenIhdr = false;
  const idatChunks: Buffer[] = [];

  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;
    if (length > maxBytes || crcEnd > bytes.length) return false;

    const type = bytes.subarray(typeStart, dataStart).toString("ascii");
    const expectedCrc = bytes.readUInt32BE(dataEnd);
    const actualCrc = pngCrc32(bytes.subarray(typeStart, dataEnd));
    if (expectedCrc !== actualCrc) return false;

    if (!seenIhdr) {
      if (type !== "IHDR" || length !== 13) return false;
      const width = bytes.readUInt32BE(dataStart);
      const height = bytes.readUInt32BE(dataStart + 4);
      const bitDepth = bytes[dataStart + 8];
      const colorType = bytes[dataStart + 9];
      if (width <= 0 || height <= 0 || width > 12000 || height > 12000) return false;
      if (![1, 2, 4, 8, 16].includes(bitDepth)) return false;
      if (![0, 2, 3, 4, 6].includes(colorType)) return false;
      seenIhdr = true;
    }
    if (type === "IDAT") {
      idatChunks.push(bytes.subarray(dataStart, dataEnd));
    }

    offset = crcEnd;
    if (type === "IEND") {
      if (!seenIhdr || offset !== bytes.length || !idatChunks.length) return false;
      try {
        return inflateSync(Buffer.concat(idatChunks)).length > 0;
      } catch {
        return false;
      }
    }
  }

  return false;
}

let pngCrcTable: number[] | null = null;

function pngCrc32(bytes: Buffer) {
  const table = pngCrcTable ?? (pngCrcTable = buildPngCrcTable());
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildPngCrcTable() {
  const table: number[] = [];
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}
