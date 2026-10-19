/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 既定の接続先 API（例: http://localhost:8787/api/v1）。未指定なら同一オリジンの /api/v1 */
  readonly VITE_API_BASE?: string;
  /** アプリ内で選べる接続先の候補。`名前=URL;名前=URL` */
  readonly VITE_API_SERVERS?: string;
}
