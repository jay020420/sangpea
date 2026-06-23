const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function hasExpectedImageSignature(buffer: Buffer, mimeType: string) {
  if (!buffer.length) return false;

  switch (mimeType) {
    case "image/jpeg":
      return buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
    case "image/png":
      return hasPngSignature(buffer);
    case "image/webp":
      return hasWebpSignature(buffer);
    default:
      return false;
  }
}

function hasPngSignature(buffer: Buffer) {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return false;
  let offset = 8;
  let hasIhdr = false;
  let hasIdat = false;

  while (offset + 12 <= buffer.length) {
    const chunkLength = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const nextOffset = offset + 12 + chunkLength;
    if (nextOffset > buffer.length) return false;
    if (type === "IHDR") hasIhdr = chunkLength === 13;
    if (type === "IDAT") hasIdat = true;
    if (type === "IEND") return hasIhdr && hasIdat;
    offset = nextOffset;
  }

  return false;
}

function hasWebpSignature(buffer: Buffer) {
  if (buffer.length < 16) return false;
  if (buffer.subarray(0, 4).toString("ascii") !== "RIFF") return false;
  if (buffer.subarray(8, 12).toString("ascii") !== "WEBP") return false;
  const declaredSize = buffer.readUInt32LE(4) + 8;
  if (declaredSize > buffer.length + 1) return false;
  const chunkType = buffer.subarray(12, 16).toString("ascii");
  return chunkType === "VP8 " || chunkType === "VP8L" || chunkType === "VP8X";
}
