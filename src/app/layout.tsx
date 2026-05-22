import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { shadcn } from "@clerk/themes";
import { esES } from "@clerk/localizations";
import "./globals.css";

// Stack del proyecto (mayo 2026): UNA sola familia, Inter, en toda la app.
// Pesos cargados:
//   - 400 / 500 / 600 → body, labels, párrafos, inputs (gradiente normal).
//   - 700 / 800 → headings display (vía la clase Tailwind `font-serif`,
//     que en globals.css mapea a Inter con peso 800 + tracking tight).
//
// Decisión: sin serif. Look tipo Linear / Vercel — máxima coherencia, cero
// vibe ofimática. Reemplazó al combo IBM Plex Sans + DM Serif Display (que
// se sentía Word) e Inter + Instrument Serif (intento intermedio).
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

// Stack de fuente para el card de Clerk. La CSS variable inyectada por
// next/font, con fallback explícito por si no propaga al árbol del
// componente Clerk en algún caso.
const CLERK_FONT_FAMILY =
  'var(--font-inter), Inter, system-ui, sans-serif';

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
        className={`dark ${inter.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col bg-background text-foreground">
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
