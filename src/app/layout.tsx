import type { Metadata, Viewport } from "next";
import { Outfit, Figtree, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { TopLoader } from "@/components/ui/top-loader";
import { prisma } from "@/lib/prisma";

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "600"],
});

const APP_DESCRIPTION = "Disparos, respostas automáticas e atendimento no WhatsApp para o seu negócio. Parte da família Saiaê.";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F6F5F2" },
    { media: "(prefers-color-scheme: dark)", color: "#18171C" },
  ],
  width: "device-width",
  initialScale: 1,
};

export async function generateMetadata(): Promise<Metadata> {
  let appName = "Saiaê";
  try {
    // @ts-ignore
    const config = await prisma.systemConfig.findUnique({ where: { id: "default" } });
    if (config?.appName) appName = config.appName;
  } catch (e) {
    console.error("Failed to fetch system config for metadata:", e);
  }

  const appDefaultTitle = `${appName} | Disparador de WhatsApp`;

  return {
    metadataBase: new URL(APP_URL),
    title: {
      default: appDefaultTitle,
      template: `%s | ${appName}`,
    },
    description: APP_DESCRIPTION,
    applicationName: appName,
    generator: "Next.js",
    keywords: [
      "whatsapp gateway", "whatsapp api", "whatsapp bot", "whatsapp management",
      "self-hosted", "wa gateway", "whatsapp multi-device", "auto-reply",
      "whatsapp dashboard", "whatsapp web api"
    ],
    referrer: "origin-when-cross-origin",
    authors: [{ name: appName }],
    creator: appName,
    publisher: appName,
    formatDetection: { telephone: false },
    robots: {
      index: process.env.NEXT_PUBLIC_ALLOW_INDEXING === "true",
      follow: process.env.NEXT_PUBLIC_ALLOW_INDEXING === "true",
      googleBot: {
        index: process.env.NEXT_PUBLIC_ALLOW_INDEXING === "true",
        follow: process.env.NEXT_PUBLIC_ALLOW_INDEXING === "true",
        "max-video-preview": -1,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
    openGraph: {
      type: "website",
      locale: "en_US",
      siteName: appName,
      title: appDefaultTitle,
      description: APP_DESCRIPTION,
      url: APP_URL,
    },
    twitter: {
      card: "summary_large_image",
      title: appDefaultTitle,
      description: APP_DESCRIPTION,
    },
    other: {
      "mobile-web-app-capable": "yes",
      "apple-mobile-web-app-capable": "yes",
      "apple-mobile-web-app-status-bar-style": "default",
      "apple-mobile-web-app-title": appName,
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const allowIndexing = process.env.NEXT_PUBLIC_ALLOW_INDEXING === "true";

  return (
    <html lang="pt-BR" suppressHydrationWarning className="scroll-smooth">
      <head>
        {/* Conditional robots meta (noindex for staging/dev) */}
        {!allowIndexing && <meta name="robots" content="noindex, nofollow" />}
        {/* DNS prefetch for performance */}
        <link rel="dns-prefetch" href={APP_URL} />
        <link rel="preconnect" href={APP_URL} crossOrigin="anonymous" />
      </head>
      <body
        className={`${figtree.variable} ${outfit.variable} ${jetbrains.variable} font-sans antialiased text-foreground bg-background selection:bg-brand selection:text-brand-foreground min-h-screen flex flex-col`}
        suppressHydrationWarning
      >
        <Providers>
          <TopLoader />
          {children}
        </Providers>
      </body>
    </html>
  );
}
