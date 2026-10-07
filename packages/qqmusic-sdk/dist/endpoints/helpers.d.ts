import type { Quality } from '../types';
export declare function num(v: unknown): number;
export declare function str(v: unknown): string;
export declare function coverUrl(albumMid: string | undefined | null, size?: number): string | null;
export interface QualitySizes {
    m4a?: number;
    s128?: number;
    s320?: number;
    flac?: number;
    ape?: number;
}
/** 由各音质文件大小推断可用音质，按偏好从高到低 */
export declare function inferQualities(s: QualitySizes): Quality[];
//# sourceMappingURL=helpers.d.ts.map