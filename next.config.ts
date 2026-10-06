import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // fotos da página inicial: cache de 30 dias no navegador e na CDN
        source: "/img/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=2592000, stale-while-revalidate=86400" }],
      },
    ];
  },
  serverExternalPackages: ["sharp", "bcryptjs"],
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
