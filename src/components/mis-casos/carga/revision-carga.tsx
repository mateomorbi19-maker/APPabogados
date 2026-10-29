"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ESTADOS_SEGUIMIENTO, ESTADO_SEGUIMIENTO_LABEL,
  ROLES_PARTE, ROL_PARTE_LABEL,
  SITUACIONES_LIBERTAD, SITUACION_LIBERTAD_LABEL,
} from "@/lib/casos/ficha";
import { FUEROS, FUERO_LABEL } from "@/lib/mapa-procesal/types";
import { MAX_TEXTO_CARGA, type FichaCarga } from "@/lib/casos/carga-schema";

const SELECT_CLS = "h-9 max-md:h-10 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:opacity-50";

const CAMPOS = [
  ["caratula", "Carátula", 500],
  ["expediente_numero", "Número de expediente", 120],
  ["organismo", "Organismo / tribunal", 300],
  ["secretaria", "Secretaría", 200],
  ["juez", "Juez/a", 200],
  ["fiscalia", "Fiscalía", 300],
] as const;

type Props = {
  ficha: FichaCarga;
  onChange: (ficha: FichaCarga) => void;
  disabled: boolean;
};

export function RevisionCarga({ ficha, onChange, disabled }: Props) {
  const set = <K extends keyof FichaCarga>(campo: K, valor: FichaCarga[K]) =>
    onChange({ ...ficha, [campo]: valor });
  const editarParte = (indice: number, cambio: Partial<FichaCarga["partes"][number]>) =>
    set("partes", ficha.partes.map((p, i) => i === indice ? { ...p, ...cambio } : p));

  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-6 disabled:opacity-70">
      <p className="text-sm text-muted-foreground">
        Revisá nombres, números y hechos contra la fuente. Los campos sin datos quedan vacíos.
        Los marcados con * son obligatorios.
      </p>
      <div className="space-y-2">
        <Label htmlFor="carga-titulo">Título de trabajo *</Label>
        <Input id="carga-titulo" value={ficha.titulo} required maxLength={500}
          onChange={(e) => set("titulo", e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="carga-descripcion">Relato de los hechos *</Label>
        <Textarea id="carga-descripcion" value={ficha.caso_descripcion} required
          maxLength={MAX_TEXTO_CARGA} className="min-h-40"
          onChange={(e) => set("caso_descripcion", e.target.value)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="carga-rol">Rol del estudio *</Label>
          <select id="carga-rol" className={SELECT_CLS} value={ficha.rol ?? ""} required
            onChange={(e) => set("rol", (e.target.value || null) as FichaCarga["rol"])}>
            <option value="">Elegí el rol</option>
            <option value="defensor">Defensa</option>
            <option value="querellante">Querella</option>
            <option value="ambos">Ambos</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="carga-estado">Estado de seguimiento</Label>
          <select id="carga-estado" className={SELECT_CLS} value={ficha.estado_seguimiento}
            onChange={(e) => set("estado_seguimiento", e.target.value as FichaCarga["estado_seguimiento"])}>
            {ESTADOS_SEGUIMIENTO.map((s) => <option key={s} value={s}>{ESTADO_SEGUIMIENTO_LABEL[s]}</option>)}
          </select>
        </div>
        {CAMPOS.map(([campo, label, maxLength]) => (
          <div key={campo} className="space-y-2">
            <Label htmlFor={`carga-${campo}`}>{label}</Label>
            <Input id={`carga-${campo}`} value={ficha[campo] ?? ""} maxLength={maxLength}
              onChange={(e) => set(campo, e.target.value || null)} />
          </div>
        ))}
        <div className="space-y-2">
          <Label htmlFor="carga-fuero">Fuero</Label>
          <select id="carga-fuero" className={SELECT_CLS} value={ficha.fuero ?? ""}
            onChange={(e) => set("fuero", (e.target.value || null) as FichaCarga["fuero"])}>
            <option value="">Sin definir</option>
            {FUEROS.map((f) => <option key={f} value={f}>{FUERO_LABEL[f]}</option>)}
          </select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="carga-delitos">Delitos · uno por renglón</Label>
        <Textarea id="carga-delitos" value={ficha.delitos.join("\n")}
          onChange={(e) => set("delitos", e.target.value.split("\n"))} />
        <p className="text-xs text-muted-foreground">Hasta 20 delitos, de 200 caracteres cada uno.</p>
      </div>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">Personas de la causa</h3>
          <Button type="button" variant="outline" size="sm" disabled={ficha.partes.length >= 40} onClick={() =>
            set("partes", [...ficha.partes, {
              nombre: "", rol: "otro", es_cliente: false, situacion_libertad: null, documento: null,
            }])}>
            <Plus className="size-4" /> Agregar persona
          </Button>
        </div>
        {ficha.partes.length === 0 ? <p className="text-sm text-muted-foreground">Sin personas cargadas.</p> : null}
        {ficha.partes.map((parte, i) => (
          <fieldset key={i} className="min-w-0 space-y-3 rounded-lg border border-border p-3">
            <legend className="px-1 text-xs text-muted-foreground">Persona {(i + 1).toLocaleString("es-AR")}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`carga-parte-${i}-nombre`}>Nombre *</Label>
                <Input id={`carga-parte-${i}-nombre`} value={parte.nombre} required maxLength={300}
                  onChange={(e) => editarParte(i, { nombre: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`carga-parte-${i}-documento`}>Documento</Label>
                <Input id={`carga-parte-${i}-documento`} value={parte.documento ?? ""} maxLength={80}
                  onChange={(e) => editarParte(i, { documento: e.target.value || null })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`carga-parte-${i}-rol`}>Rol en la causa</Label>
                <select id={`carga-parte-${i}-rol`} className={SELECT_CLS} value={parte.rol}
                  onChange={(e) => editarParte(i, {
                    rol: e.target.value as typeof parte.rol,
                    situacion_libertad: e.target.value === "imputado" ? parte.situacion_libertad : null,
                  })}>
                  {ROLES_PARTE.map((r) => <option key={r} value={r}>{ROL_PARTE_LABEL[r]}</option>)}
                </select>
              </div>
              {parte.rol === "imputado" ? (
                <div className="space-y-2">
                  <Label htmlFor={`carga-parte-${i}-situacion`}>Situación de libertad</Label>
                  <select id={`carga-parte-${i}-situacion`} className={SELECT_CLS} value={parte.situacion_libertad ?? ""}
                    onChange={(e) => editarParte(i, { situacion_libertad: (e.target.value || null) as typeof parte.situacion_libertad })}>
                    <option value="">Sin definir</option>
                    {SITUACIONES_LIBERTAD.map((s) => <option key={s} value={s}>{SITUACION_LIBERTAD_LABEL[s]}</option>)}
                  </select>
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={parte.es_cliente}
                  onChange={(e) => editarParte(i, { es_cliente: e.target.checked })} />
                Es cliente del estudio
              </label>
              <Button type="button" variant="ghost" size="sm" onClick={() =>
                set("partes", ficha.partes.filter((_, j) => j !== i))}>
                <Trash2 className="size-4" /> Quitar persona
              </Button>
            </div>
          </fieldset>
        ))}
      </section>
    </fieldset>
  );
}
