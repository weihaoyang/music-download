import type { Quality } from '../types';

export function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

export function coverUrl(albumMid: string | undefined | null, size = 300): string | null {
  return albumMid ? `https://y.gtimg.cn/music/photo_new/T002R${size}x${size}M000${albumMid}.jpg` : null;
}

export interface QualitySizes {
  m4a?: number;
  s128?: number;
  s320?: number;
  flac?: number;
  ape?: number;
}

/** 由各音质文件大小推断可用音质，按偏好从高到低 */
export function inferQualities(s: QualitySizes): Quality[] {
  const out: Quality[] = [];
  if (num(s.flac) > 0) out.push('flac');
  if (num(s.ape) > 0) out.push('ape');
  if (num(s.s320) > 0) out.push('320');
  if (num(s.s128) > 0) out.push('128');
  if (num(s.m4a) > 0) out.push('m4a');
  // 兜底：至少给个 128
  if (out.length === 0) out.push('128');
  return out;
}
