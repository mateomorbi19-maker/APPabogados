"use client";
import { useEffect, useState } from "react";
import { CalendarCheck2, CalendarX2, Loader2, RefreshCw } from "lucide-react";
import { SignOutButton } from "@clerk/nextjs";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Props = {
  // Se llama tras un sync exitoso para que el parent recargue (y aparezcan los
  // íconos de "sincronizado" en las cards).
  onSynced: () => void;
};

type Estado = "checking" | "connected" | "disconnected" | "error";

export function GoogleCalendarStatus({ onSynced }: Props) {
  const [estado, setEstado] = useState<Estado>("checking");
  const [syncing, setSyncing] = useState(false);

  // Check de conexión al montar (GET no tiene efectos: solo consulta si hay
  // token de Google con scope de calendario).
  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const res = await fetch("/api/agenda/eventos/sync");
        // Éxito = objeto crudo { connected }; error = { ok: false }.
        const json = (await res.json().catch(() => null)) as
          | { connected: boolean }
          | { ok: false }
          | null;
        if (cancelado) return;
        if (res.ok && json && "connected" in json) {
          setEstado(json.connected ? "connected" : "disconnected");
        } else {
          setEstado("error");
        }
      } catch {
        if (!cancelado) setEstado("error");
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await fetch("/api/agenda/eventos/sync", { method: "POST" });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; synced: true; count: number }
        | { ok: true; synced: false; reason: string }
        | { ok: false; error?: string }
        | null;
      if (!res.ok || !json || json.ok === false) {
        toast.error("No se pudo sincronizar con Google Calendar");
        return;
      }
      if (json.synced === false) {
        // El usuario perdió/nunca tuvo el scope: pasamos a estado desconectado.
        setEstado("disconnected");
        toast.error("Conectá tu Google Calendar primero");
        return;
      }
      const n = json.count;
      toast.success(
        n > 0
          ? `${n} evento${n === 1 ? "" : "s"} sincronizado${n === 1 ? "" : "s"} con Google Calendar`
          : "Todo al día: no había eventos pendientes",
      );
      onSynced();
    } catch {
      toast.error("Error de red al sincronizar");
    } finally {
      setSyncing(false);
    }
  };

  if (estado === "checking") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Verificando Google Calendar…
      </span>
    );
  }

  if (estado === "connected") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
          <CalendarCheck2 className="size-4" /> Google Calendar sincronizado
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSync}
          disabled={syncing}
        >
          {syncing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          {syncing ? "Sincronizando..." : "Sincronizar pendientes"}
        </Button>
      </div>
    );
  }

  // disconnected | error → banner con CTA de reconexión.
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 sm:flex-row sm:items-center">
      <CalendarX2 className="size-5 shrink-0 text-amber-400" />
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          Conectá tu Google Calendar para que tus eventos aparezcan en tu
          teléfono.
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {estado === "error"
            ? "No pudimos verificar la conexión. "
            : "Si iniciaste sesión antes de activar la sincronización, "}
          cerrá sesión y volvé a entrar con Google para habilitarla.
        </p>
      </div>
      <SignOutButton redirectUrl="/sign-in">
        <Button variant="outline" size="sm" className="shrink-0">
          Conectar
        </Button>
      </SignOutButton>
    </div>
  );
}
