"use client";

// El dock de LEXIE: la esfera flotante + la ventana de chat.
//
// Reemplaza a `lexie-launcher.tsx`, y hay tres diferencias de fondo:
//
// 1. VIVE EN EL LAYOUT RAÍZ, no en NavShell. El launcher anterior colgaba del
//    shell de navegación, así que LEXIE simplemente NO EXISTÍA en el Mapa
//    procesal, el Simulador, el chat de una causa ni el panel de Admin — que son
//    vistas inmersivas sin NavShell, y justo donde más se agradece poder
//    preguntar algo sin salir.
//
// 2. VA POR PORTAL a <body>. No es opcional: un ancestro con `backdrop-filter`
//    —la TopBar tiene uno— se convierte en bloque contenedor de sus
//    descendientes `fixed` y les abre un contexto de apilado propio. Sin el
//    portal, el `fixed` de la esfera se resolvería contra el header de 56px en
//    vez de contra el viewport. Está documentado en mobile-nav.tsx, que ya se
//    comió ese bug.
//
// 3. NO BLOQUEA NADA. El contenedor es `pointer-events-none` y solo la esfera y
//    la ventana lo revierten, así que todo lo que queda "debajo" del dock sigue
//    recibiendo clicks con normalidad.

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useCapacidadDelBrowser } from "@/lib/hooks/use-cliente";
import { EsferaLexie } from "./esfera-lexie";
import { VentanaLexie } from "./ventana-lexie";
import { LexieChat } from "./lexie-chat";

/** Tiene que ser estable entre renders: si no, useSyncExternalStore re-suscribe en loop. */
const HAY_DOM = () => typeof document !== "undefined";

export function LexieDock() {
  // Sin sesión no hay LEXIE: montada en el layout raíz, el dock también
  // alcanzaría a /sign-in y a /sign-up. (En Clerk v7 no existe `<SignedIn>`;
  // el equivalente para un client component es este hook.)
  const { isSignedIn } = useAuth();
  // /forbidden es la pantalla del que tiene sesión de Google pero no está en la
  // whitelist del estudio. Ahí LEXIE devolvería 403 a todo: mejor no ofrecerla.
  const pathname = usePathname();
  // `createPortal` necesita `document`, que en el server no existe. El patrón
  // obvio —`useState(false)` + `setMontado(true)` en un efecto— dispara el
  // cascading render que el lint del repo prohíbe; `useCapacidadDelBrowser` es
  // el helper que ya existe para esto: devuelve false en el server (así el
  // markup hidrata sin desajuste) y true en el cliente, en el mismo commit.
  const montado = useCapacidadDelBrowser(HAY_DOM);
  const [abierto, setAbierto] = useState(false);
  const [ocupada, setOcupada] = useState(false);
  // Remontar el chat con una key nueva es todo lo que hace falta para
  // "conversación nueva": el componente arranca limpio y vuelve a pedir el
  // saludo. Sin esto habría que exponer un reset hacia adentro del chat y
  // resetear su estado desde un efecto, que es el patrón de cascading renders
  // que el lint del repo marca.
  const [hilo, setHilo] = useState(0);

  // Ctrl/⌘ + J abre y cierra, igual que antes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setAbierto((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const nuevaConversacion = useCallback(async () => {
    try {
      // Archiva la activa server-side. Si falla, igual se remonta el chat: el
      // abogado ve el hilo de nuevo y puede reintentar, que es mejor que
      // quedarse con un botón que no hace nada.
      await fetch("/api/lexie", { method: "DELETE" });
    } catch {
      /* el remonte de abajo igual devuelve el control */
    }
    setHilo((n) => n + 1);
  }, []);

  if (!montado || !isSignedIn || pathname.startsWith("/forbidden")) return null;

  return createPortal(
    // `inset-0` con `pointer-events-none`: el dock cubre la pantalla para poder
    // posicionar a sus hijos contra el viewport, pero no intercepta un solo
    // click. Los hijos vuelven a `pointer-events-auto` por su cuenta.
    <div className="pointer-events-none fixed inset-0 z-40">
      {abierto && (
        <VentanaLexie
          onCerrar={() => setAbierto(false)}
          onNuevaConversacion={() => void nuevaConversacion()}
        >
          <LexieChat key={hilo} onOcupadaChange={setOcupada} />
        </VentanaLexie>
      )}
      <EsferaLexie
        abierto={abierto}
        onToggle={() => setAbierto((v) => !v)}
        ocupada={ocupada}
      />
    </div>,
    document.body,
  );
}
