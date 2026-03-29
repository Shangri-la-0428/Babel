const distDir = process.env.NODE_ENV === "production" ? ".next-prod" : ".next-dev";

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir,
  output: "standalone",
  compress: true,
  experimental: {
    optimizePackageImports: ["react", "react-dom"],
  },
};

export default nextConfig;
