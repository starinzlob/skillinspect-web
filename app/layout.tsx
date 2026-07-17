import type { Metadata } from "next";
import { headers } from "next/headers";
import { Libre_Franklin, Newsreader } from "next/font/google";
import "./globals.css";

const newsreader = Newsreader({
  variable: "--font-editorial",
  subsets: ["latin"],
});

const libreFranklin = Libre_Franklin({
  variable: "--font-sans",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host?.includes("localhost") ? "http" : "https");
  const origin = host ? `${protocol}://${host}` : undefined;
  const image = origin ? `${origin}/og.png` : undefined;
  return {
    title: {
      default: "SkillInspect",
      template: "%s · SkillInspect",
    },
    description: "Installation intelligence for Agent Skills.",
    openGraph: {
      title: "SkillInspect — Read the small print",
      description: "Inspect an Agent Skill before it reads your machine.",
      type: "website",
      ...(image ? { images: [{ url: image, width: 1200, height: 630, alt: "SkillInspect — Read the small print" }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: "SkillInspect — Read the small print",
      description: "Inspect an Agent Skill before it reads your machine.",
      ...(image ? { images: [image] } : {}),
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${newsreader.variable} ${libreFranklin.variable}`}>
        {children}
      </body>
    </html>
  );
}
