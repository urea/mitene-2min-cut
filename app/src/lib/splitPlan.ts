export const MAX_SEGMENT_SECONDS = 116
export const OVERLAP_SECONDS = 2

export type SplitSegment = {
  index: number
  startSeconds: number
  endSeconds: number
}

export type SplitPlan = {
  maxSegmentSeconds: number
  overlapSeconds: number
  segments: SplitSegment[]
}

export function createSplitPlan(
  durationSeconds: number,
  maxSegmentSeconds = MAX_SEGMENT_SECONDS,
  overlapSeconds = OVERLAP_SECONDS,
): SplitPlan {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { maxSegmentSeconds, overlapSeconds, segments: [] }
  }

  const segments: SplitSegment[] = []
  let startSeconds = 0
  let index = 1

  while (startSeconds < durationSeconds) {
    const endSeconds = Math.min(durationSeconds, startSeconds + maxSegmentSeconds)
    segments.push({ index, startSeconds, endSeconds })

    if (endSeconds >= durationSeconds) break

    startSeconds = Math.max(0, endSeconds - overlapSeconds)
    index += 1
  }

  return { maxSegmentSeconds, overlapSeconds, segments }
}
