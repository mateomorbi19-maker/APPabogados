"use client";
// Filtros del panel admin. Los aplica vía query params en la URL para que
// sean compartibles y persistentes al navegar / al refrescar / al volver.
//
// Patrón: form controlado con state local; al submit (o al click "Aplicar")
// hace router.push con los nuevos params. La page server-side relee los
// searchParams y se rerendera. NO hacemos optimistic updates porque la
// query a Supabase es rápida (< 200ms con 27 filas).

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { EstadoEjecucion, UsuarioLite } from "@/lib/admin/types";

type Props = {
  usuarios: UsuarioLite[];
};

const ESTADOS: { value: EstadoEjecucion | "todos"; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "ok", label: "OK" },
  { value: "error", label: "Error" },
  { value: "degradada", label: "Degradada" },
];

const SELECT_CLS =
  "h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20";

export function EjecucionesFilters({ usuarios }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [usuario, setUsuario] = useState(searchParams.get("usuario") ?? "todos");
  const [estado, setEstado] = useState(searchParams.get("estado") ?? "todos");
  const [desde, setDesde] = useState(searchParams.get("desde") ?? "");
  const [hasta, setHasta] = useState(searchParams.get("hasta") ?? "");
  const [q, setQ] = useState(searchParams.get("q") ?? "");

  const aplicar = (e: FormEvent) => {
    e.preventDefault();
    const sp = new URLSearchParams();
    if (usuario && usuario !== "todos") sp.set("usuario", usuario);
    if (estado && estado !== "todos") sp.set("estado", estado);
    if (desde) {
      // Comienzo del día en zona AR (UTC-3 en mayo, sin DST). Convertimos
      // a ISO con offset para que el server lo compare bien con ejecutado_en.
      sp.set("desde", `${desde}T00:00:00-03:00`);
    }
    if (hasta) {
      sp.set("hasta", `${hasta}T23:59:59-03:00`);
    }
    if (q.trim()) sp.set("q", q.trim());
    // Reseteamos page al aplicar filtros: no tiene sentido quedarse en pág 5
    // si el filtro nuevo solo devuelve 12 resultados.
    router.push(`/admin?${sp.toString()}`);
  };

  const limpiar = () => {
    setUsuario("todos");
    setEstado("todos");
    setDesde("");
    setHasta("");
    setQ("");
    router.push("/admin");
  };

  const haAlgunFiltroAplicado =
    (searchParams.get("usuario") && searchParams.get("usuario") !== "todos") ||
    (searchParams.get("estado") && searchParams.get("estado") !== "todos") ||
    searchParams.get("desde") ||
    searchParams.get("hasta") ||
    searchParams.get("q");

  return (
    <form
      onSubmit={aplicar}
      className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-card/50 px-3 py-2"
    >
      <div className="flex flex-col gap-1">
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Usuario
        </label>
        <select
          className={cn(SELECT_CLS, "min-w-32")}
          value={usuario}
          onChange={(e) => setUsuario(e.target.value)}
        >
          <option value="todos">Todos</option>
          {usuarios.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nombre}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Estado
        </label>
        <select
          className={cn(SELECT_CLS, "min-w-28")}
          value={estado}
          onChange={(e) => setEstado(e.target.value)}
        >
          {ESTADOS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Desde
        </label>
        <Input
          type="date"
          className="h-9"
          value={desde}
          onChange={(e) => setDesde(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Hasta
        </label>
        <Input
          type="date"
          className="h-9"
          value={hasta}
          onChange={(e) => setHasta(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1 flex-1 min-w-48">
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Buscar en caso
        </label>
        <Input
          type="text"
          placeholder="ej: homicidio, Sebastián, etc"
          className="h-9"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm">
          Aplicar
        </Button>
        {haAlgunFiltroAplicado ? (
          <Button type="button" size="sm" variant="ghost" onClick={limpiar}>
            Limpiar
          </Button>
        ) : null}
      </div>
    </form>
  );
}
