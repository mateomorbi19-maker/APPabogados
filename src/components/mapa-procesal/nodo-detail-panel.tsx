"use client";
import { useEffect, useState } from "react";
import { Check, Loader2, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { EstadoNodo, NodoProcesalDB, TipoNodo } from "@/lib/mapa-procesal/types";

const ESTADO_LABEL: Record<EstadoNodo, string> = {
  ocurrido: "Ocurrido",
  desbloqueado: "Desbloqueado",
  bloqueado: "Bloqueado",
};
const TIPO_LABEL: Record<TipoNodo, string> = {
  raiz: "Raíz",
  real: "Real",
  prediccion: "Predicción",
};
const ESTADO_BADGE: Record<EstadoNodo, string> = {
  ocurrido: "bg-violet-500/10 text-violet-300 border-violet-500/20",
  desbloqueado: "bg-blue-500/10 text-blue-300 border-blue-500/20",
  bloqueado: "bg-gray-500/10 text-gray-300 border-gray-500/20",
};

type Props = {
  nodo: NodoProcesalDB;
  hijos: NodoProcesalDB[];
  onClose: () => void;
  onSelectNodo: (id: string) => void;
  onMarcarOcurrido: (id: string) => Promise<void>;
  onAgregarHijo: (id: string) => void;
  onEditar: (
    id: string,
    data: { titulo?: string; descripcion?: string | null },
  ) => Promise<void>;
  onEliminar: (id: string) => Promise<void>;
};

export function NodoDetailPanel({
  nodo,
  hijos,
  onClose,
  onSelectNodo,
  onMarcarOcurrido,
  onAgregarHijo,
  onEditar,
  onEliminar,
}: Props) {
  const esRaiz = nodo.tipo === "raiz";
  const [titulo, setTitulo] = useState(nodo.titulo);
  const [descripcion, setDescripcion] = useState(nodo.descripcion ?? "");
  const [saving, setSaving] = useState(false);
  const [marking, setMarking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset al cambiar de nodo.
  useEffect(() => {
    setTitulo(nodo.titulo);
    setDescripcion(nodo.descripcion ?? "");
    setConfirmDelete(false);
  }, [nodo.id, nodo.titulo, nodo.descripcion]);

  const tituloTrim = titulo.trim();
  const dirty =
    (!esRaiz && tituloTrim !== nodo.titulo) ||
    descripcion.trim() !== (nodo.descripcion ?? "").trim();
  const puedeGuardar = dirty && tituloTrim.length > 0;

  const guardar = async () => {
    if (saving || !puedeGuardar) return;
    setSaving(true);
    try {
      await onEditar(nodo.id, {
        ...(esRaiz ? {} : { titulo: tituloTrim }),
        descripcion: descripcion.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  };

  const marcar = async () => {
    if (marking) return;
    setMarking(true);
    try {
      await onMarcarOcurrido(nodo.id);
    } finally {
      setMarking(false);
    }
  };

  const eliminar = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await onEliminar(nodo.id);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <aside className="absolute right-0 top-0 z-10 flex h-full w-80 flex-col border-l border-border bg-background shadow-xl duration-200 animate-in slide-in-from-right">
      <header className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1 space-y-2">
          {esRaiz ? (
            <h2 className="font-medium leading-tight">{nodo.titulo}</h2>
          ) : (
            <Input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              maxLength={200}
              className="font-medium"
              aria-label="Título del nodo"
            />
          )}
          <div className="flex flex-wrap gap-1.5">
            <Badge className={ESTADO_BADGE[nodo.estado]}>
              {ESTADO_LABEL[nodo.estado]}
            </Badge>
            <Badge variant="outline">{TIPO_LABEL[nodo.tipo]}</Badge>
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Cerrar">
          <X className="size-4" />
        </Button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div className="space-y-1.5">
          <Label htmlFor="nodo-desc">Descripción</Label>
          <Textarea
            id="nodo-desc"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="Agregá una descripción..."
          />
        </div>

        {puedeGuardar ? (
          <Button size="sm" onClick={guardar} disabled={saving} className="w-full">
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {saving ? "Guardando..." : "Guardar cambios"}
          </Button>
        ) : null}

        {/* Acciones de estado */}
        {nodo.estado === "desbloqueado" ? (
          <Button
            onClick={marcar}
            disabled={marking}
            className="w-full bg-emerald-600 text-white hover:bg-emerald-600/90"
          >
            {marking ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            {marking ? "Marcando..." : "Marcar como ocurrido"}
          </Button>
        ) : nodo.estado === "ocurrido" ? (
          <div className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-400">
            <Check className="size-4" /> Ocurrido
          </div>
        ) : null}

        <Button
          variant="outline"
          size="sm"
          onClick={() => onAgregarHijo(nodo.id)}
          className="w-full"
        >
          <Plus className="size-4" />
          Agregar evento hijo
        </Button>

        {/* Hijos directos */}
        {hijos.length > 0 ? (
          <div className="space-y-1.5">
            <Label>Eventos hijos</Label>
            <div className="flex flex-wrap gap-1.5">
              {hijos.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => onSelectNodo(h.id)}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-xs transition-colors hover:opacity-80",
                    ESTADO_BADGE[h.estado],
                  )}
                  title={ESTADO_LABEL[h.estado]}
                >
                  {h.titulo}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* Eliminar (no raíz) */}
      {!esRaiz ? (
        <footer className="border-t border-border px-4 py-3">
          {confirmDelete ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Se eliminará este nodo y todos sus descendientes. No se puede
                deshacer.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleting}
                  className="flex-1"
                >
                  Cancelar
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={eliminar}
                  disabled={deleting}
                  className="flex-1"
                >
                  {deleting ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  {deleting ? "Eliminando..." : "Confirmar"}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-4" />
              Eliminar nodo
            </Button>
          )}
        </footer>
      ) : null}
    </aside>
  );
}
