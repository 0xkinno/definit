import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  /**
   * Pin the traced root to this project.
   *
   * Without it, Next walks up the directory tree, finds an unrelated lockfile
   * and treats that directory as the workspace root -- which changes what gets
   * bundled into a deployment.
   */
  outputFileTracingRoot: here,
};

export default nextConfig;
