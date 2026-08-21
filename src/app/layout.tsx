import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { shadcn } from "@clerk/themes";
import { esES } from "@clerk/localizations";
import { TemaProvider } from "@/components/tema/tema-provider";
import { RegistrarSW } from "@/components/pwa/registrar-sw";
import { SCRIPT_ANTI_FLASH } from "@/components/tema/tema";
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
  // === Instalable como app (iOS y Android) ===
  // El manifest (src/app/manifest.ts) cubre Android. iOS lo ignora casi por
  // completo y se guía por estas dos cosas: `apple-mobile-web-app-capable`
  // (que es lo que saca la barra de Safari al abrir desde el ícono) y el
  // apple-touch-icon.
  applicationName: "EstrategiaLegal",
  appleWebApp: {
    capable: true,
    title: "EstrategiaLegal",
    // La barra de estado se pinta con el fondo de la app en vez de quedar
    // blanca sobre el canvas oscuro.
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  // Sin esto, iOS abre los links de la app en Safari aunque esté instalada.
  formatDetection: { telephone: false },
  other: {
    // Next 16 emite `mobile-web-app-capable` (el nombre estándar del W3C) y
    // deliberadamente NO emite el de Apple. Verificado leyendo el <head>
    // renderizado: apple-mobile-web-app-title y -status-bar-style sí salen,
    // pero -capable no.
    //
    // iOS 15.4+ ya respeta `display: standalone` del manifest, así que en un
    // iPhone actualizado alcanza. Pero en los anteriores esta meta es lo ÚNICO
    // que hace que el ícono abra la app sin la barra de Safari — que es
    // exactamente la diferencia entre "una app" y "un acceso directo a una
    // página". Cuesta una línea; va.
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  // `viewportFit: cover` deja que el contenido use la pantalla completa en los
  // teléfonos con notch; los componentes compensan con env(safe-area-inset-*).
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  themeColor: "#08080c",
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
      {/* `dark` en el HTML del servidor porque oscuro es el default de la app.
          El script de abajo lo saca antes del primer paint si el abogado eligió
          "Sistema" y su sistema está en claro. `suppressHydrationWarning` es
          necesario justamente por eso: el className del <html> que ve React al
          hidratar puede no ser el que renderizó el servidor. */}
      <html
        lang="es"
        suppressHydrationWarning
        className={`dark ${inter.variable} ${display.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col bg-background text-foreground">
          <script
            // Primer nodo del body: corre sincrónicamente antes de que el
            // browser pinte nada del contenido.
            dangerouslySetInnerHTML={{ __html: SCRIPT_ANTI_FLASH }}
          />
          <RegistrarSW />
          <TemaProvider>{children}</TemaProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
