import type { MetadataRoute } from "next";

// TODO: the icons under /icons are placeholders that satisfy installability
// requirements only. A later icon task will replace them with final artwork.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Parchís Stars",
    short_name: "Parchís Stars",
    description:
      "Juega al Parchís Stars con tus amigos: elige un avatar, comparte un código y tira los dados.",
    id: "/",
    start_url: "/alone",
    scope: "/",
    display: "fullscreen",
    display_override: ["fullscreen", "standalone", "minimal-ui", "browser"],
    background_color: "#efe5cf",
    theme_color: "#efe5cf",
    lang: "es",
    dir: "ltr",
    categories: ["games"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
