import type { Metadata } from "next";
import localFont from "next/font/local";
import "drawably/style.css";
import "./globals.css";

const openRunde = localFont({
  src: [
    {
      path: "../public/fonts/OpenRunde-Regular-BF64ee9c6978988.woff",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/fonts/OpenRunde-Medium-BF64ee9c695513a.woff",
      weight: "500",
      style: "normal",
    },
    {
      path: "../public/fonts/OpenRunde-Semibold-BF64ee9c69788f3.woff",
      weight: "600",
      style: "normal",
    },
    {
      path: "../public/fonts/OpenRunde-Bold-BF64ee9c696534f.woff",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-open-runde",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Parchís Stars — Juega con amigos",
  description:
    "Parchís Stars: elige tu avatar, crea una partida o únete con un código y juega al Parchís con tus amigos.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${openRunde.variable} ${openRunde.className} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
