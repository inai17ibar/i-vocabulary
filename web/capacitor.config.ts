import type { CapacitorConfig } from "@capacitor/cli";

/** iOS アプリ（Capacitor）。Web のビルド成果物 dist/ をアプリに同梱し、API はサーバーへ HTTP で叩く */
const config: CapacitorConfig = {
  appId: "dev.ivocab.app",
  appName: "i-vocab",
  webDir: "dist",
  ios: { contentInset: "never" },
};

export default config;
