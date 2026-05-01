import { Sparkles } from "lucide-react";

// Bloque estático "próxima entrega" — el agente conversacional sobre el
// caso (basado en estrategia + timeline) viene en una sesión futura.
// Sin lógica, sin backend. Borde dasheado violeta + badge.
export function PlaceholderAgenteSugerido() {
  return (
    <div className="rounded-lg border border-dashed border-primary/40 p-6 space-y-2">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-primary" />
        <h3 className="font-medium text-sm">Próximo paso sugerido por el agente</h3>
        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">
          Próxima entrega
        </span>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">
        En la próxima versión, el agente va a poder conversar con vos sobre
        los próximos pasos del caso, basándose en la estrategia elegida y
        los eventos del timeline.
      </p>
    </div>
  );
}
