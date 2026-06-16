"use client";
import { useState } from "react";
import { CalendarCheck2, Loader2, RefreshCw } from "lucide-react";
import { SignOutButton } from "@clerk/nextjs";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// Componente presentacional: el estado de conexión lo resuelve y posee
// agenda-view (lo necesita también para el badge del header y la stat
// "Pendientes de sync"). Acá solo mostramos + disparamos el sync.
type Props = {
  connected: boolean | null; // null = verificando
  onSynced: () => void;
  onConnectedChange: (c: boolean) => void;
};

export function GoogleCalendarStatus({
  connected,
  onSynced,
  onConnectedChange,
}: Props) {
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await fetch("/api/agenda/eventos/sync", { method: "POST" });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; synced: true; pushed: number; pulled: number }
        | { ok: true; synced: false; reason: string }
        | { ok: false; error?: string }
        | null;
      if (!res.ok || !json || json.ok === false) {
        toast.error("No se pudo sincronizar con Google Calendar");
        return;
      }
      if (json.synced === false) {
        onConnectedChange(false);
        toast.error("Conectá tu Google Calendar primero");
        return;
      }
      const { pushed, pulled } = json;
      if (pushed === 0 && pulled === 0) {
        toast.success("Todo al día con Google Calendar");
      } else {
        const partes: string[] = [];
        if (pushed > 0) partes.push(`${pushed} subido${pushed === 1 ? "" : "s"}`);
        if (pulled > 0)
          partes.push(`${pulled} actualizado${pulled === 1 ? "" : "s"} desde Google`);
        toast.success(partes.join(" · "));
      }
      onSynced();
    } catch {
      toast.error("Error de red al sincronizar");
    } finally {
      setSyncing(false);
    }
  };

  if (connected === null) {
    return (
      <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Google Calendar…
      </p>
    );
  }

  if (connected) {
    return (
      <div className="space-y-2">
        <p className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
          <CalendarCheck2 className="size-3.5" /> Google Calendar
        </p>
        <Button
          variant="outline"
          size="sm"
          className="w-full text-muted-foreground"
          onClick={handleSync}
          disabled={syncing}
        >
          {syncing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          {syncing ? "Sincronizando..." : "Sincronizar"}
        </Button>
      </div>
    );
  }

  // Desconectado
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Google Calendar</p>
      <SignOutButton redirectUrl="/sign-in">
        <Button
          variant="outline"
          size="sm"
          className="w-full text-muted-foreground"
        >
          Conectar
        </Button>
      </SignOutButton>
    </div>
  );
}
