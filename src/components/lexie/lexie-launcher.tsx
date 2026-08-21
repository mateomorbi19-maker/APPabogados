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
          className="fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full border border-[var(--el-violet)]/30 bg-[var(--el-violet)] px-4 py-3 text-sm font-medium text-white shadow-lg shadow-[var(--el-violet)]/25 transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--el-violet-light)] mb-[env(safe-area-inset-bottom)]"
        >
          <Sparkles className="size-4" />
          <span className="hidden sm:inline">LEXIE</span>
        </button>
      )}
      {abierto && <LexiePanel onCerrar={() => setAbierto(false)} />}
    </>
  );
}
