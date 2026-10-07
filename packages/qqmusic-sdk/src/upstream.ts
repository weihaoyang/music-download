// QQ 请求签名：仅保留 sign（写操作 / 续期需要），其余 qq-music-api 能力已由自研实现替代。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const signFn = require('qq-music-api/util/sign') as (obj: unknown) => string;

export function sign(obj: unknown): string {
  return signFn(obj);
}
