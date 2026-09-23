import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * discord.js e seus módulos são usados apenas no servidor (route handler)
   * e fazem imports opcionais em runtime (ex.: zlib-sync), então saem do bundle.
   */
  serverExternalPackages: ["discord.js", "@discordjs/ws", "@discordjs/rest"],
};

export default nextConfig;
