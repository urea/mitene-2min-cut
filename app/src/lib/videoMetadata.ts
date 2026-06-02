const METADATA_SCAN_BYTES = 16 * 1024 * 1024
const QUICKTIME_EPOCH_MS = Date.UTC(1904, 0, 1)

export async function readVideoCaptureTime(file: File) {
  const buffers = await readMetadataBuffers(file)

  for (const buffer of buffers) {
    const captureTime = parseMp4CreationTime(buffer)
    if (captureTime) return captureTime
  }

  return null
}

async function readMetadataBuffers(file: File) {
  const headSize = Math.min(file.size, METADATA_SCAN_BYTES)
  const buffers = [await file.slice(0, headSize).arrayBuffer()]

  if (file.size > METADATA_SCAN_BYTES) {
    buffers.push(await file.slice(Math.max(0, file.size - METADATA_SCAN_BYTES)).arrayBuffer())
  }

  return buffers
}

function parseMp4CreationTime(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)

  for (let index = 4; index < bytes.length - 16; index += 1) {
    if (!isMvhdBox(bytes, index)) continue

    const headerOffset = index - 4
    const size = view.getUint32(headerOffset)
    const version = view.getUint8(index + 4)
    const minimumSize = version === 1 ? 120 : version === 0 ? 108 : null
    const creationSeconds =
      version === 1 ? readUint64(view, index + 8) : version === 0 ? view.getUint32(index + 8) : null

    if (!creationSeconds || !minimumSize || size < minimumSize) continue

    const date = new Date(QUICKTIME_EPOCH_MS + creationSeconds * 1000)
    if (isPlausibleCaptureDate(date)) return date
  }

  return null
}

function isMvhdBox(bytes: Uint8Array, typeOffset: number) {
  return (
    bytes[typeOffset] === 0x6d &&
    bytes[typeOffset + 1] === 0x76 &&
    bytes[typeOffset + 2] === 0x68 &&
    bytes[typeOffset + 3] === 0x64
  )
}

function readUint64(view: DataView, offset: number) {
  const high = view.getUint32(offset)
  const low = view.getUint32(offset + 4)
  const value = high * 2 ** 32 + low

  return Number.isSafeInteger(value) ? value : null
}

function isPlausibleCaptureDate(date: Date) {
  const year = date.getUTCFullYear()

  return !Number.isNaN(date.getTime()) && year >= 1990 && year <= 2100
}
