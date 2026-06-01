import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { ArrowRight, Check, Download, Film, FolderOpen, Scissors, ShieldCheck } from 'lucide-react'
import { formatClockDuration, formatDateTime, formatFileSize } from './lib/format'
import { createSplitPlan } from './lib/splitPlan'
import { splitVideo } from './lib/videoSplitter'
import type { SplitOutput, SplitProgress } from './lib/videoSplitter'
import type { SelectedVideo } from './types/video'

const STATUS_ITEMS = [
  '2分を超えない',
  '元動画はそのまま',
  '端末内で処理',
  '撮影日時を守る',
]

export function App() {
  const [video, setVideo] = useState<SelectedVideo | null>(null)
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [outputs, setOutputs] = useState<Array<SplitOutput & { url: string }>>([])
  const [splitProgress, setSplitProgress] = useState<SplitProgress | null>(null)
  const [splitError, setSplitError] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDragActive, setIsDragActive] = useState(false)
  const [metadataError, setMetadataError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)

  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [objectUrl])

  useEffect(() => {
    return () => {
      outputs.forEach((output) => URL.revokeObjectURL(output.url))
    }
  }, [outputs])

  const plan = useMemo(() => {
    if (!video?.durationSeconds) return null
    return createSplitPlan(video.durationSeconds)
  }, [video?.durationSeconds])

  const hasVideo = Boolean(video?.file)
  const hasOutputs = outputs.length > 0
  const canPickVideo = !isProcessing
  const canSplit = Boolean(video?.file && plan && !isProcessing)
  const canSave = outputs.length > 0 && !isProcessing
  const pickActionState = hasVideo ? 'done' : 'active'
  const splitActionState = !hasVideo ? 'pending' : hasOutputs ? 'done' : 'active'
  const saveActionState = hasOutputs ? 'active' : 'pending'
  const actionStatus = (() => {
    if (isDragActive && canPickVideo) {
      return {
        title: 'ここにドロップできます',
        detail: 'MP4、MOV、M4Vの動画を選択します。',
        progress: null,
      }
    }

    if (isProcessing && splitProgress) {
      return {
        title: splitProgress.message,
        detail: `${Math.round(splitProgress.progress * 100)}%`,
        progress: splitProgress.progress,
      }
    }

    if (hasOutputs) {
      return {
        title: `${outputs.length}本の動画を作成しました`,
        detail: '保存できます。作成した動画は保存するまでブラウザ内の一時データです。',
        progress: 1,
      }
    }

    if (video && plan) {
      return {
        title: `${plan.segments.length}本に分けます`,
        detail: '内容を確認したら分割できます。',
        progress: null,
      }
    }

    if (video) {
      return {
        title: '動画を確認しています',
        detail: '長さを読み取っています。',
        progress: null,
      }
    }

    return {
      title: '動画を選んでください',
      detail: 'ボタンで選ぶか、PCではこのエリアへドロップできます。',
      progress: null,
    }
  })()

  const selectVideoFile = (file: File) => {
    if (objectUrl) URL.revokeObjectURL(objectUrl)

    const url = URL.createObjectURL(file)
    setObjectUrl(url)
    setOutputs([])
    setSplitProgress(null)
    setSplitError(null)
    setMetadataError(null)
    setVideo({
      file,
      fileName: file.name,
      fileSize: file.size,
      lastModified: new Date(file.lastModified),
      durationSeconds: null,
    })

    const probe = document.createElement('video')
    probe.preload = 'metadata'
    probe.src = url
    probe.onloadedmetadata = () => {
      setVideo((current) =>
        current
          ? {
              ...current,
              durationSeconds: Number.isFinite(probe.duration) ? probe.duration : null,
            }
          : current,
      )
    }
    probe.onerror = () => {
      setMetadataError('動画の長さを読み取れませんでした。別の動画で試してください。')
    }
  }

  const handlePickVideo = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) selectVideoFile(file)

    event.target.value = ''
  }

  const openPicker = () => inputRef.current?.click()

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!canPickVideo) return

    dragDepthRef.current += 1
    setIsDragActive(true)
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = canPickVideo ? 'copy' : 'none'
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!canPickVideo) return

    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setIsDragActive(false)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragDepthRef.current = 0
    setIsDragActive(false)

    if (!canPickVideo) return

    const file = Array.from(event.dataTransfer.files).find(isSupportedDropFile)
    if (!file) {
      setMetadataError('MP4、MOV、M4Vの動画ファイルをドロップしてください。')
      return
    }

    selectVideoFile(file)
  }

  const handleSplit = async () => {
    if (!video?.file || !plan || isProcessing) return

    setIsProcessing(true)
    setSplitError(null)
    setOutputs([])

    try {
      const splitOutputs = await splitVideo({
        file: video.file,
        segments: plan.segments,
        onProgress: setSplitProgress,
      })

      setOutputs(
        splitOutputs.map((output) => ({
          ...output,
          url: URL.createObjectURL(output.blob),
        })),
      )
    } catch (error) {
      setSplitError(error instanceof Error ? error.message : '動画の分割に失敗しました。')
    } finally {
      setIsProcessing(false)
    }
  }

  const saveAllOutputs = () => {
    if (!outputs.length) return

    setSplitError(null)
    outputs.forEach((output) => {
      const link = document.createElement('a')
      link.href = output.url
      link.download = output.fileName
      link.rel = 'noopener'
      document.body.appendChild(link)
      link.click()
      link.remove()
    })
  }

  return (
    <main className="app-shell">
      <section className="workspace" aria-labelledby="app-title">
        <div className="intro">
          <div className="brand-mark" aria-hidden="true">
            <Film size={24} strokeWidth={2.2} />
          </div>
          <div>
            <h1 id="app-title">みてね2分カット</h1>
            <p>画質そのまま、撮影日時そのまま。長い動画を投稿しやすい長さに整えます。</p>
          </div>
        </div>

        <div
          className="upload-panel"
          data-drag-active={isDragActive ? 'true' : 'false'}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          aria-label="動画の選択と分割操作"
        >
          <input
            ref={inputRef}
            hidden
            type="file"
            accept="video/mp4,video/quicktime,.mp4,.mov,.m4v"
            onChange={handlePickVideo}
          />
          <div className="action-flow" aria-label="操作手順">
            <button
              className="flow-action"
              type="button"
              onClick={openPicker}
              disabled={!canPickVideo}
              data-state={pickActionState}
              aria-current={pickActionState === 'active' ? 'step' : undefined}
            >
              <FolderOpen size={20} aria-hidden="true" />
              動画を選ぶ
            </button>
            <span className="flow-connector" aria-hidden="true">
              <ArrowRight size={20} strokeWidth={2.4} />
            </span>
            <button
              className="flow-action"
              type="button"
              onClick={handleSplit}
              disabled={!canSplit}
              data-state={splitActionState}
              aria-current={splitActionState === 'active' && !isProcessing ? 'step' : undefined}
            >
              <Scissors size={20} aria-hidden="true" />
              {isProcessing ? '分割中' : '分割'}
            </button>
            <span className="flow-connector" aria-hidden="true">
              <ArrowRight size={20} strokeWidth={2.4} />
            </span>
            <button
              className="flow-action"
              type="button"
              onClick={saveAllOutputs}
              disabled={!canSave}
              data-state={saveActionState}
              aria-current={saveActionState === 'active' ? 'step' : undefined}
            >
              <Download size={20} aria-hidden="true" />
              すべて保存
            </button>
          </div>
          <div className="action-status" aria-live="polite">
            <div>
              <strong>{actionStatus.title}</strong>
              <span>{actionStatus.detail}</span>
            </div>
            {typeof actionStatus.progress === 'number' ? (
              <progress value={actionStatus.progress} max={1} />
            ) : null}
          </div>
        </div>

        {metadataError ? <p className="error-text">{metadataError}</p> : null}

        {video ? (
          <section className="result-grid" aria-label="選択した動画">
            <div className="summary-panel">
              <p className="section-label">選択した動画</p>
              <h2>動画を読み込みました</h2>
              <dl className="meta-list">
                <div>
                  <dt>長さ</dt>
                  <dd>
                    {video.durationSeconds
                      ? formatClockDuration(video.durationSeconds)
                      : '読み取り中'}
                  </dd>
                </div>
                <div>
                  <dt>サイズ</dt>
                  <dd>{formatFileSize(video.fileSize)}</dd>
                </div>
                <div>
                  <dt>端末から渡された名前</dt>
                  <dd>{video.fileName}</dd>
                </div>
                <div>
                  <dt>ファイル更新日時</dt>
                  <dd>{video.lastModified.toLocaleString('ja-JP')}</dd>
                </div>
              </dl>
            </div>

            <div className="summary-panel accent-panel">
              <p className="section-label">分割計画</p>
              {plan ? (
                <>
                  <h2>{plan.segments.length}本に分けます</h2>
                  <p className="panel-note">
                    1本あたり最大{plan.maxSegmentSeconds}秒。境界は{plan.overlapSeconds}
                    秒重ねて欠けにくくします。
                  </p>
                  <ol className="segment-list">
                    {plan.segments.map((segment) => (
                      <li key={segment.index}>
                        <span>{segment.index}</span>
                        <strong>
                          {formatClockDuration(segment.startSeconds)} -{' '}
                          {formatClockDuration(segment.endSeconds)}
                        </strong>
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <p className="panel-note">動画の長さを確認しています。</p>
              )}
            </div>
          </section>
        ) : (
          <section className="empty-state" aria-label="初期状態">
            <ShieldCheck size={38} aria-hidden="true" />
            <div>
              <h2>動画は外部に送信しません</h2>
              <p>ブラウザ上で動画情報を確認し、分割処理も端末内で完結させる方針です。</p>
              <div className="status-row" aria-label="処理方針">
                {STATUS_ITEMS.map((item) => (
                  <span key={item}>
                    <Check size={15} aria-hidden="true" />
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </section>
        )}

        {splitError ? <p className="error-text">{splitError}</p> : null}

        {outputs.length > 0 ? (
          <section className="downloads-panel" aria-label="作成した動画">
            <div className="downloads-header">
              <div>
                <p className="section-label">作成した動画</p>
                <h2>保存対象の一覧</h2>
                <p>元の動画は変更していません。</p>
              </div>
            </div>
            <ol className="download-list">
              {outputs.map((output) => (
                <li key={output.fileName}>
                  <div>
                    <strong>{output.fileName}</strong>
                    <span>
                      {formatClockDuration(output.segment.startSeconds)} -{' '}
                      {formatClockDuration(output.segment.endSeconds)} /{' '}
                      {formatDateTime(output.captureTime)}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </section>
    </main>
  )
}

function isSupportedDropFile(file: File) {
  return /\.(mp4|mov|m4v)$/i.test(file.name)
}
