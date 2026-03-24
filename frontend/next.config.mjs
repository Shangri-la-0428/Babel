/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  compress: true,
  experimental: {
    optimizePackageImports: ["react", "react-dom"],
  },
};

export default nextConfig;
