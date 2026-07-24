import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const nextConfig: NextConfig = {};

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw/sw.ts",
  swDest: "public/sw.js",
  // @serwist/next injects a webpack config, which Next 16's Turbopack (the
  // default for `next dev`) doesn't support. Disabling it in dev is a no-op
  // anyway — defaultCache degrades to NetworkOnly outside production. The
  // production build must run with `next build --webpack` (see package.json).
  disable: process.env.NODE_ENV !== "production",
});

export default withSerwist(nextConfig);
