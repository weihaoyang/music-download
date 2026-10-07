export { createQQMusicClient } from './client';
export type { QQMusicClient, AuthApi } from './client';

export { QQMusicError, isQQMusicError, isAuthError, normalizeUpstreamError } from './errors';
export type { QQErrorCode } from './errors';

export { FileTokenStore, MemoryTokenStore } from './auth/stores';
export { HttpCookieProvider } from './auth/providers';
export { TokenManager } from './auth/token-manager';
export { QrLogin, hash33, getGtk, parseSetCookie } from './auth/qr-login';
export type { QrLoginType, QrLoginState, QrLoginStart, QrLoginResult } from './auth/qr-login';
export { parseCookie, maskKey, resolveConfig } from './config';

export type {
  AddSongsParams,
  AddSongsResult,
  AuthState,
  AuthStatus,
  Cookie,
  CookieProvider,
  CreatePlaylistParams,
  DeletePlaylistParams,
  DownloadParams,
  HealthResult,
  HttpConfig,
  Logger,
  LyricResult,
  Page,
  PlaylistBrief,
  PlaylistCloneParams,
  PlaylistDetail,
  PlaylistDetailParams,
  PlaylistImportParams,
  PlaylistResolveParams,
  Profile,
  Quality,
  QQMusicClientConfig,
  QuickItem,
  QuickResult,
  RefreshConfig,
  ResolvedConfig,
  SearchParams,
  Song,
  SongDetailParams,
  SongUrl,
  SongUrlParams,
  TokenStore,
} from './types';
