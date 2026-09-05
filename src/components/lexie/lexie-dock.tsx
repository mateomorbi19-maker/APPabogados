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
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useCapacidadDelBrowser } from "@/lib/hooks/use-cliente";
import { EsferaLexie } from "./esfera-lexie";
import { VentanaLexie } from "./ventana-lexie";
import { LexieChat } from "./lexie-chat";
import { useAlMutarLexie } from "./acciones-lexie";

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
  // Un mensaje que otra pantalla quiere dejar escrito en el campo de LEXIE
  // (por ejemplo "¿qué escrito me conviene?" desde la ficha de una causa).
  // Va con un contador para que el mismo texto pedido dos veces se vuelva a
  // sembrar: el chat compara el número, no el string. NUNCA se autoenvía —
  // el abogado lo lee y decide, igual que con el dictado por voz.
  const [precarga, setPrecarga] = useState<{ texto: string; n: number } | null>(
    null,
  );

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

  // `lexie-abrir`: cualquier componente puede abrir la ventana, con o sin un
  // mensaje precargado. Es un CustomEvent de window y no un contexto de React
  // a propósito: el dock vive en el layout raíz y quien lo dispara está en
  // cualquier punto del árbol, muchas veces adentro de un diálogo modal.
  useEffect(() => {
    const onAbrir = (e: Event) => {
      const detail = (e as CustomEvent<{ mensaje?: unknown }>).detail;
      const mensaje =
        typeof detail?.mensaje === "string" ? detail.mensaje : null;
      if (mensaje) setPrecarga((p) => ({ texto: mensaje, n: (p?.n ?? 0) + 1 }));
      setAbierto(true);
    };
    window.addEventListener("lexie-abrir", onAbrir);
    return () => window.removeEventListener("lexie-abrir", onAbrir);
  }, []);

  // `lexie-mutacion`: LEXIE acaba de crear, editar o borrar algo. La ventana
  // es NO modal y flota sobre la sección que sea, así que lo que está detrás
  // tiene que reflejarlo sin recargar. Este `router.refresh()` cubre a los
  // SERVER components (el detalle de una causa, los `casos` que recibe la
  // Agenda): vuelve a pedir el payload RSC de la ruta actual y React lo mezcla
  // sin perder el estado de los client components. Las vistas que cargan por
  // fetch propio (Agenda, Bandeja, la lista de Mis casos) escuchan el mismo
  // evento y refrescan con su mecanismo — un refresh de RSC no las toca.
  const router = useRouter();
  useAlMutarLexie(
    useCallback(() => {
      router.refresh();
    }, [router]),
  );

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
          <LexieChat
            key={hilo}
            onOcupadaChange={setOcupada}
            precarga={precarga}
          />
        </VentanaLexie>
      )}
      {/* La esfera es el botón de ABRIR: con el chat abierto no tiene función y
          se saca, en cualquier tamaño de pantalla. En el teléfono además tapaba
          la hoja del chat sin tener para dónde correrse. Para cerrar están la X
          de la ventana, Escape y Ctrl/⌘+J. */}
      {!abierto && (
        <EsferaLexie onAbrir={() => setAbierto(true)} ocupada={ocupada} />
      )}
    </div>,
    document.body,
  );
}
