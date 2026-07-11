import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_GITHUB_AUTH_CONFIGURED: (process.env.GITHUB_ID && process.env.GITHUB_SECRET) ? "true" : "false"
  },
  compiler: {
    styledComponents: true,
  },
 
    allowedDevOrigins: ['3000-firebase-driftseekgit-1775514209589.cluster-sumfw3zmzzhzkx4mpvz3ogth4y.cloudworkstations.dev'],
    
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
