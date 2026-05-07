"use client";
// Wrapper colapsable que envuelve las secciones existentes del análisis
// original (caso + estrategia elegida). Por defecto cerrado: cuando el
// abogado vuelve al caso después de varios eventos, no necesita ver
// re-leer el análisis cada vez. Lo expande on-demand.

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { Caso } from "@/lib/types";
import { SeccionCasoOriginal } from "./seccion-caso-original";
import { SeccionEstrategiaElegida } from "./seccion-estrategia-elegida";

type Props = {
  caso: Caso;
};

export function AnalisisOriginalColapsable({ caso }: Props) {
  return (
    <Collapsible className="rounded-md border border-border bg-card/30">
      <CollapsibleTrigger
        render={
          <Button
            variant="ghost"
            className="group w-full justify-between rounded-md rounded-b-none px-4 py-3 h-auto hover:bg-muted/30"
          />
        }
      >
        <div className="flex flex-col items-start gap-0.5">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            Análisis original
          </span>
          <span className="text-sm font-medium">
            Caso y estrategia elegida (al crear el caso)
          </span>
        </div>
        <ChevronDown className="size-4 ml-1.5 shrink-0 transition-transform group-data-open:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0">
        <div className="border-t border-border px-4 py-4 space-y-4">
          <SeccionCasoOriginal caso={caso} />
          <SeccionEstrategiaElegida caso={caso} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
