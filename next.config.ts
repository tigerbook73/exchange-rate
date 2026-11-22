import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import withSerwistInit from "@serwist/next";

const nextConfig: NextConfig = {};

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw/sw.ts",
  swDest: "public/sw.js",
  // Cloudflare consumes these as deployment configuration; they are not URLs.
  // Precaching /_headers returns 404 and aborts service-worker installation.
  globPublicPatterns: ["**/!(_headers|_redirects)"],
  // @serwist/next injects a webpack config, which Next 16's Turbopack (the
  // default for `next dev`) doesn't support. Disabling it in dev is a no-op
  // anyway — defaultCache degrades to NetworkOnly outside production. The
  // production build must run with `next build --webpack` (see package.json).
  disable: process.env.NODE_ENV !== "production",
});

export default function configureNext(phase: string) {
  // Only local development needs Cloudflare bindings. Production builds on
  // Vercel and Cloudflare must not start Wrangler's local runtime.
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    void import("@opennextjs/cloudflare").then((m) =>
      m.initOpenNextCloudflareForDev(),
    );
  }

  return withSerwist(nextConfig);
}
