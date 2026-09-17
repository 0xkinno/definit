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
  /**
   * The development indicator is a floating badge that renders in a portal on
   * top of the page. It is noise in a screenshot and noise on a product, so it
   * is switched off explicitly rather than left on a default.
   */
  devIndicators: false,
};

export default nextConfig;
