import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Configure Turbopack (Next.js 16 default)
  turbopack: {
    // Empty config to silence the warning
    // Turbopack handles WASM automatically
  },
  
  // Also keep webpack config for backward compatibility
  webpack: (config) => {
    // Enable WASM support for netgrep
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };

    // Handle WASM files
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'webassembly/async',
    });

    return config;
  },
};

export default nextConfig;
