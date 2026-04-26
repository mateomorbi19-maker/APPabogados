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
      <CollapsibleTrigger className="group flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
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
