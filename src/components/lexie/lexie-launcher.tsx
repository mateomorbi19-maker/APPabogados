"use client";
// Botón flotante que abre a LEXIE, montado una sola vez en el shell.
//
// El panel se monta recién al abrirse (`abierto && <LexiePanel />` sería
// suficiente, pero además el componente hace su propio return null): así el
// GET /api/lexie no se dispara en cada navegación, solo cuando alguien la
// llama de verdad.
//
// Atajo: Ctrl/⌘ + J. La ⌘K ya es del buscador global.

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { LexiePanel } from "./lexie-panel";

export function LexieLauncher() {
  const [abierto, setAbierto] = useState(false);

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

  return (
    <>
      {!abierto && (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          aria-label="Abrir LEXIE (Ctrl+J)"
          title="LEXIE — Ctrl+J"
          // Abajo de 640px el label ya estaba escondido (`hidden sm:inline`) y
          // quedaba un botón de 48x40 con el ícono descentrado; ahí pasa a ser
          // un círculo de 48x48, que es el tamaño de un FAB y respeta el piso
          // táctil. El corte va en `max-sm:` justo para que coincida con el
          // del label: de 640px para arriba sigue siendo la píldora con texto.
          //
          // Los `env(safe-area-inset-*)` van como margen porque el elemento es
          // fixed con bottom/right fijados: el margen lo corre hacia adentro
          // del área segura (la barra de gestos de iOS abajo, el notch cuando
          // el teléfono está apaisado a la derecha).
          className="fixed bottom-5 right-5 z-30 mr-[env(safe-area-inset-right)] mb-[env(safe-area-inset-bottom)] flex items-center justify-center gap-2 rounded-full border border-[var(--el-violet)]/30 bg-[var(--el-violet)] px-4 py-3 text-sm font-medium text-white shadow-lg shadow-[var(--el-violet)]/25 transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--el-violet-light)] max-sm:size-12 max-sm:p-0"
        >
          <Sparkles className="size-4" />
          <span className="hidden sm:inline">LEXIE</span>
        </button>
      )}
      {abierto && <LexiePanel onCerrar={() => setAbierto(false)} />}
    </>
  );
}
