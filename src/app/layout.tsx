import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { shadcn } from "@clerk/themes";
import { esES } from "@clerk/localizations";
import "./globals.css";

// Stack del proyecto (rediseño jun 2026):
//   - Body / UI: Inter (sans), expuesta como --font-sans.
//   - Display / Headings + wordmark: Space Grotesk, expuesta como
//     --font-display. Reemplaza a Instrument Serif (serif) por una grotesque
//     moderna con tracking ajustado — más acorde a un producto SaaS dark.
//     El remapeo de --font-serif/--font-heading → --font-display en
//     globals.css hace que los títulos existentes adopten la grotesque sin
//     tocar cada componente.
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const display = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600"],
});

// Stack de fuente para el card de Clerk. La CSS variable inyectada por
// next/font, con fallback explícito por si no propaga al árbol del
// componente Clerk en algún caso.
const CLERK_FONT_FAMILY =
  'var(--font-sans), Inter, system-ui, sans-serif';

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
        className={`dark ${inter.variable} ${display.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col bg-background text-foreground">
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
