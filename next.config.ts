import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compiler: {
    styledComponents: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "encrypted-tbn0.gstatic.com",
      },
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
    ],
  },
   turbopack: {},
  webpack: (config) => {
    config.externals.push({
      express: "commonjs express",
      "node-pty": "commonjs node-pty",
      "socket.io": "commonjs socket.io",
    });

    return config;
  },
};

export default nextConfig;
