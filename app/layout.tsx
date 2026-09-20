import type { Metadata, Viewport } from "next";
import { Archivo, Martian_Mono } from "next/font/google";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-sans",
  subsets: ["latin"],
});

const martianMono = Martian_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Votr: Politics made easier to understand",
    template: "%s · Votr",
  },
  description:
    "Explore candidates, issues, elections and local politics in one place. Votr informs; it never tells you who to vote for.",
  applicationName: "Votr",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/votr-logo.svg", type: "image/svg+xml" },
    ],
  },
  openGraph: {
    title: "Votr: Politics made easier to understand",
    description:
      "Candidates, issues and elections, federal to local, in one place. No endorsements, no rankings.",
    siteName: "Votr",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0A1124",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${martianMono.variable} h-full antialiased`}
    >
      {/* overflow-x-clip is the backstop for the hero's floating accents; it
          clips without creating a scroll container, so sticky nav still works. */}
      <body className="flex min-h-full flex-col overflow-x-clip">
        <noscript>
          {/* Scroll reveals server-render hidden. Without JS they never
              un-hide, so the page would be blank below the hero. */}
          <style>{`[data-reveal]{opacity:1!important;transform:none!important}`}</style>
        </noscript>
        {children}
      </body>
    </html>
  );
}
