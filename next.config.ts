import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Media uploads (lesson videos/audio) go through server actions;
      // the default 1MB body limit would reject them.
      bodySizeLimit: "500mb",
    },
  },
};

export default nextConfig;
