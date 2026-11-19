import type { NextConfig } from "next";

// `TAURI_BUILD=1` (set by scripts/build-desktop.mjs) produces the fully static
// export that Tauri embeds in the desktop binary. The web build keeps the
// server-capable Cache Components and PWA configuration.
const isDesktopBuild = process.env.TAURI_BUILD === "1";

const nextConfig: NextConfig = {
  experimental: {
    agentFeedback: true,
  },
  ...(isDesktopBuild
    ? {
        output: "export" as const,
        // The static export has no server, so the signaling route handler
        // (`route.ts`, a `.ts` file) must not be part of the build at all.
        // Every page in this app is a `.tsx` file, so dropping `.ts` from the
        // page extensions excludes route handlers from the export.
        pageExtensions: ["tsx", "jsx", "js"],
        // The export has no Next.js image optimizer or server, so images are
        // served directly from the bundled public/ files.
        images: { unoptimized: true },
        // Emit route/index.html so Tauri's asset resolver can serve
        // /play/ and /offline/ without a server rewrite.
        trailingSlash: true,
      }
    : {
        cacheComponents: true,
        partialPrefetching: true,
        // `@vercel/functions` dynamically imports `ws` during the upgrade;
        // keep it external so the serverless bundle resolves the dependency.
        serverExternalPackages: ["ws"],
      }),
  turbopack: {
    root: __dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

if (!isDesktopBuild) {
  // Routes removed when the setup flow was unified into `/`. Installed PWAs
  // (the old start URL was `/alone`) and old bookmarks can still request them,
  // so send those navigations to the home page instead of a 404.
  nextConfig.redirects = async () => [
    {
      source: "/alone/:path*",
      destination: "/",
      permanent: false,
    },
    {
      source: "/lan/:path*",
      destination: "/",
      permanent: false,
    },
  ];

  // Custom response headers require a Node.js server and are unsupported in a
  // static export, so they are only configured for the web build.
  nextConfig.headers = async () => [
    {
      source: "/sw.js",
      headers: [
        {
          key: "Content-Type",
          value: "application/javascript; charset=utf-8",
        },
        {
          key: "Cache-Control",
          value: "no-cache, no-store, must-revalidate",
        },
        {
          key: "Service-Worker-Allowed",
          value: "/",
        },
      ],
    },
    {
      source: "/manifest.webmanifest",
      headers: [
        {
          key: "Cache-Control",
          value: "no-store",
        },
      ],
    },
  ];
}

export default nextConfig;
