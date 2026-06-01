import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import type { LogEvent, ProgressEvent } from '@ffmpeg/ffmpeg'
import type { SplitSegment } from './splitPlan'

const FFMPEG_CORE_URL = '/ffmpeg/ffmpeg-core.js'
const FFMPEG_WASM_URL = '/ffmpeg/ffmpeg-core.wasm'
const SUPPORTED_EXTENSIONS = new Set(['mp4', 'mov', 'm4v'])

export type SplitProgressStage = 'loading' | 'probing' | 'writing' | 'splitting' | 'reading' | 'done'

export type SplitProgress = {
  stage: SplitProgressStage
  message: string
  progress: number
}

export type SplitOutput = {
  fileName: string
  blob: Blob
  segment: SplitSegment
  captureTime: Date
}

type SplitVideoOptions = {
  file: File
  segments: SplitSegment[]
  onProgress?: (progress: SplitProgress) => void
}

export async function splitVideo({ file, segments, onProgress }: SplitVideoOptions) {
  if (segments.length === 0) return []

  const extension = getSupportedExtension(file.name)
  if (!extension) {
    throw new Error('現在の初期版では、MP4またはMOVの動画を選んでください。')
  }

  const ffmpeg = new FFmpeg()
  const logs: string[] = []
  let activeSegment = 0

  const handleLog = ({ message }: LogEvent) => {
    logs.push(message)
  }

  const handleProgress = ({ progress }: ProgressEvent) => {
    const safeProgress = Number.isFinite(progress) ? clamp(progress, 0, 1) : 0
    onProgress?.({
      stage: 'splitting',
      message: `${activeSegment}/${segments.length}本目を作成しています。`,
      progress: (activeSegment - 1 + safeProgress) / segments.length,
    })
  }

  ffmpeg.on('log', handleLog)
  ffmpeg.on('progress', handleProgress)

  const inputName = `input.${extension}`
  const stem = file.name.replace(/\.[^/.]+$/, '')
  const outputs: SplitOutput[] = []

  try {
    onProgress?.({ stage: 'loading', message: '分割エンジンを準備しています。', progress: 0 })
    const coreURL = await toBlobURL(FFMPEG_CORE_URL, 'text/javascript')
    const wasmURL = await toBlobURL(FFMPEG_WASM_URL, 'application/wasm')
    await ffmpeg.load({
      coreURL,
      wasmURL,
    })

    onProgress?.({ stage: 'writing', message: '動画を端末内の作業領域に読み込んでいます。', progress: 0 })
    await ffmpeg.writeFile(inputName, await fetchFile(file))

    onProgress?.({ stage: 'probing', message: '撮影日時を確認しています。', progress: 0 })
    const baseCaptureTime = await readCreationTime(ffmpeg, inputName, logs, file.lastModified)

    for (const segment of segments) {
      activeSegment = segment.index
      const outputName = buildOutputFileName(stem, segment.index, segments.length, extension)
      const segmentDuration = segment.endSeconds - segment.startSeconds
      const captureTime = new Date(baseCaptureTime.getTime() + Math.round(segment.startSeconds * 1000))
      const creationTime = captureTime.toISOString()

      const result = await ffmpeg.exec([
        '-ss',
        secondsArg(segment.startSeconds),
        '-i',
        inputName,
        '-t',
        secondsArg(segmentDuration),
        '-map',
        '0',
        '-map_metadata',
        '0',
        '-c',
        'copy',
        '-avoid_negative_ts',
        'make_zero',
        '-metadata',
        `creation_time=${creationTime}`,
        '-metadata:s:v:0',
        `creation_time=${creationTime}`,
        '-movflags',
        'use_metadata_tags+faststart',
        outputName,
      ])

      if (result !== 0) {
        throw new Error('動画の分割に失敗しました。別の動画で試してください。')
      }

      onProgress?.({
        stage: 'reading',
        message: `${segment.index}/${segments.length}本目を保存用に準備しています。`,
        progress: segment.index / segments.length,
      })

      const data = await ffmpeg.readFile(outputName)
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
      outputs.push({
        fileName: outputName,
        blob: new Blob([new Uint8Array(bytes)], { type: mimeTypeForExtension(extension) }),
        segment,
        captureTime,
      })

      await ffmpeg.deleteFile(outputName)
    }

    onProgress?.({ stage: 'done', message: `${outputs.length}本の動画を作成しました。`, progress: 1 })
    return outputs
  } finally {
    ffmpeg.off('log', handleLog)
    ffmpeg.off('progress', handleProgress)
    ffmpeg.terminate()
  }
}

async function readCreationTime(
  ffmpeg: FFmpeg,
  inputName: string,
  previousLogs: string[],
  fallbackTimestamp: number,
) {
  const outputName = 'probe.txt'

  try {
    await ffmpeg.ffprobe([
      '-v',
      'error',
      '-show_entries',
      'format_tags=creation_time:stream_tags=creation_time',
      '-of',
      'default=noprint_wrappers=1',
      inputName,
      '-o',
      outputName,
    ])

    const probeData = await ffmpeg.readFile(outputName, 'utf8')
    await ffmpeg.deleteFile(outputName)
    const fromProbe = parseCreationTime(String(probeData))
    if (fromProbe) return fromProbe
  } catch {
    const fromLogs = parseCreationTime(previousLogs.join('\n'))
    if (fromLogs) return fromLogs
  }

  return new Date(fallbackTimestamp)
}

function parseCreationTime(text: string) {
  const matches = text.matchAll(/creation_time\s*=\s*([^\s]+)/gi)

  for (const match of matches) {
    const value = match[1]
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return date
  }

  return null
}

function getSupportedExtension(fileName: string) {
  const extension = fileName.split('.').pop()?.toLowerCase()
  return extension && SUPPORTED_EXTENSIONS.has(extension) ? extension : null
}

function buildOutputFileName(stem: string, index: number, total: number, extension: string) {
  const safeStem = stem.trim() || 'video'
  const width = Math.max(2, String(total).length)
  return `${safeStem}_${String(index).padStart(width, '0')}of${String(total).padStart(width, '0')}.${extension}`
}

function mimeTypeForExtension(extension: string) {
  if (extension === 'mov') return 'video/quicktime'
  return 'video/mp4'
}

function secondsArg(seconds: number) {
  return seconds.toFixed(3).replace(/\.?0+$/, '')
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
