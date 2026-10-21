import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";
import { Splash } from "@/components/splash";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: { default: "Hygieia Wellness Clinic · Queue", template: "%s · Hygieia Wellness Clinic" },
  description: "Token-based queue for walk-ins and appointments.",
};

export const viewport: Viewport = {
  themeColor: "#f4f1fa",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${manrope.variable} ${cormorant.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Splash />
        {children}
      </body>
    </html>
  );
}
