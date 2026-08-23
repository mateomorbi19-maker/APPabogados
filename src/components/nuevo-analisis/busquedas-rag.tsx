"use client";
import { ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { Busqueda } from "@/lib/schemas";

type Props = { busquedas: Busqueda[] };

export function BusquedasRag({ busquedas }: Props) {
  if (busquedas.length === 0) return null;

  return (
    <Collapsible>
      {/* En móvil el trigger sube a 44px de alto y ocupa todo el ancho: sin
          padding medía ~20px, la mitad del piso táctil, y es el único acceso a
          la trazabilidad del RAG (qué buscó el agente y con qué similarity). En
          escritorio queda como estaba. */}
      <CollapsibleTrigger className="group flex items-center gap-2 text-left text-sm text-muted-foreground hover:text-foreground transition-colors max-md:min-h-11 max-md:w-full max-md:py-2">
        <ChevronDown className="size-4 transition-transform duration-200 group-data-[panel-open]:rotate-180" />
        Búsquedas en jurisprudencia y código penal ({busquedas.length})
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 space-y-2">
        {busquedas.map((b, i) => (
          <Card key={`${i}-${b.query}`} className="p-3 space-y-1">
            <p className="font-mono text-xs break-words">{b.query}</p>
            <p className="text-xs text-muted-foreground">
              {b.chunks_devueltos} chunks recuperados
              {b.similarity_top !== null
                ? ` · similarity top ${b.similarity_top.toFixed(3)}`
                : ""}
            </p>
          </Card>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
