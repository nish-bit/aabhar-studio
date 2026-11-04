import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import { MotionProvider } from "@/components/motion/motion-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

// Self-hosted (SIL Open Font License, see src/fonts/LICENSE-*). No requests to Google at build or run time.
const inter = localFont({
  src: "../fonts/inter-latin-wght.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
});

const cormorant = localFont({
  src: [
    { path: "../fonts/cormorant-garamond-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../fonts/cormorant-garamond-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-cormorant",
  display: "swap",
  fallback: ["Georgia", "serif"],
});

export const metadata: Metadata = {
  title: {
    default: "Aabhar Studio — AI jewellery photography and catalogues",
    template: "%s · Aabhar Studio",
  },
  description:
    "Turn phone photos of jewellery into clean, consistent product images and build catalogues for your shop, brand or wholesale buyers.",
  // Preview build: keep out of search engines until launch.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#faf7f2",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-IN" data-scroll-behavior="smooth" className={`${inter.variable} ${cormorant.variable}`}>
      <body>
        <MotionProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
