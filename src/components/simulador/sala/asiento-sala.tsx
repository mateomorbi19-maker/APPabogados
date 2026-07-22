"use client";
// Un puesto de la sala: marco con el avatar + placa de nombre, y dos estados
// superpuestos que NO son excluyentes (decisión de Mateo, 2026-07-22):
//
//   activo     → el rol acaba de hablar: anillo, glow, elevación y ecualizador.
//   esTuTurno  → el asiento del abogado espera su intervención: badge "TE TOCA".
//
// Al final del turno de la sala los dos conviven: el juez te cede la palabra
// (queda iluminado) y vos tenés que hablar. Mostrar solo uno perdía de vista
// quién te dio la palabra.
//
// El color sale de una custom property (`--el-c`) que se setea acá y consumen
// las clases .el-seat-* de globals.css. Es la misma técnica del mapa procesal.

import { cn } from "@/lib/utils";
import { ELENCO, colorDe, type Asiento } from "@/lib/simulador/sala";
import { AvatarRol } from "./avatar-rol";

const TAM_MARCO: Record<Asiento["tam"], string> = {
  lg: "size-12 md:size-[72px]",
  md: "size-11 md:size-16",
  sm: "size-9 md:size-[54px]",
};

type Props = {
  asiento: Asiento;
  activo?: boolean;
  esTuTurno?: boolean;
  // Nombre propio si se conoce (ej. el imputado del expediente). Cae al
  // institucional del ELENCO.
  nombre?: string;
  // El asiento lo ocupa el abogado: la placa dice "Vos".
  esUsuario?: boolean;
};

export function AsientoSala({
  asiento,
  activo = false,
  esTuTurno = false,
  nombre,
  esUsuario = false,
}: Props) {
  const ficha = ELENCO[asiento.rol];
  const etiqueta = esUsuario ? "Vos" : (nombre ?? ficha.nombre);

  return (
    <div
      className={cn(
        "el-seat absolute flex flex-col items-center gap-1.5",
        activo && "el-seat-active",
        esTuTurno && "el-seat-turn",
      )}
      style={
        {
          left: `${asiento.x}%`,
          top: `${asiento.y}%`,
          "--el-c": colorDe(asiento.rol),
        } as React.CSSProperties
      }
    >
      {/* Ecualizador: señal redundante de "está hablando", además del color. */}
      {activo ? (
        <div className="el-eq absolute -top-5 left-1/2 flex h-3.5 -translate-x-1/2 items-end gap-0.5">
          <span />
          <span />
          <span />
          <span />
        </div>
      ) : null}

      {esTuTurno ? (
        <div className="el-turnpill absolute -top-[19px] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-2 py-[3px] text-[9px] font-bold tracking-[0.08em]">
          TE TOCA
        </div>
      ) : null}

      <div
        className={cn(
          "el-seat-frame flex items-center justify-center rounded-2xl border border-[var(--el-border)] bg-gradient-to-b from-[#141c2c] to-[#0d1420] shadow-[0_6px_16px_rgba(0,0,0,.4)]",
          TAM_MARCO[asiento.tam],
        )}
      >
        <AvatarRol rol={asiento.rol} className="size-full rounded-2xl" />
      </div>

      <div className="text-center leading-[1.15]">
        <div className="el-seat-name max-w-[86px] truncate text-[10px] font-semibold md:max-w-[120px] md:text-[11px]">
          {etiqueta}
        </div>
        <div className="max-w-[86px] truncate text-[8.5px] text-[var(--el-text-muted)] md:max-w-[120px] md:text-[9.5px]">
          {ficha.rol}
        </div>
      </div>
    </div>
  );
}
