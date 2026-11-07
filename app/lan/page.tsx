"use client";

import dynamic from "next/dynamic";

const LanClient = dynamic(
  () => import("@/components/lan/lan-client").then((module) => module.LanClient),
  {
    ssr: false,
    loading: () => (
      <main className="grid min-h-dvh place-items-center px-4">
        <p className="text-sm text-stone-500">Preparando la conexión…</p>
      </main>
    ),
  },
);

export default function LanPage() {
  return <LanClient />;
}
