import type { Metadata } from "next";
import { IBM_Plex_Sans, DM_Serif_Display } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { shadcn } from "@clerk/themes";
import { esES } from "@clerk/localizations";
import "./globals.css";

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const dmSerifDisplay = DM_Serif_Display({
  variable: "--font-dm-serif-display",
  subsets: ["latin"],
  weight: ["400"],
});

// Stack de fuente para el card de Clerk. La CSS variable inyectada por
// next/font, con fallback explícito por si no propaga al árbol del
// componente Clerk en algún caso.
const CLERK_FONT_FAMILY =
  'var(--font-ibm-plex-sans), "IBM Plex Sans", system-ui, sans-serif';

export const metadata: Metadata = {
  title: "EstrategiaLegal",
  description: "Análisis estratégico de casos penales asistido por IA",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // baseTheme `shadcn` lee toda la paleta de las CSS vars de globals.css
    // (--card, --card-foreground, --muted-foreground, --primary, etc.). Por
    // eso no overrideamos colores acá: el theme se adapta solo si la paleta
    // del proyecto cambia. Solo personalizamos tipografía y radio.
    <ClerkProvider
      localization={esES}
      appearance={{
        baseTheme: shadcn,
        variables: {
          fontFamily: CLERK_FONT_FAMILY,
          borderRadius: "0.5rem",
        },
      }}
    >
      <html
        lang="es"
        className={`dark ${ibmPlexSans.variable} ${dmSerifDisplay.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col bg-background text-foreground">
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
