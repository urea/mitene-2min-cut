export type SelectedVideo = {
  file: File
  fileName: string
  fileSize: number
  captureTime: Date | null
  isCaptureTimeLoading: boolean
  durationSeconds: number | null
}
