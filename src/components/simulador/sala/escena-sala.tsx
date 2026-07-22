"use client";
// Escenario de la audiencia: mobiliario dibujado en SVG (estrado, escudo, las
// dos mesas de parte) con los asientos posicionados en porcentajes encima.
//
// Todo es SVG/CSS inline: sin imágenes, sin librerías de gráficos. El SVG usa
// un viewBox fijo 1000x300 con preserveAspectRatio, así que el mobiliario
// escala solo y los asientos (en %) lo siguen.
//
// Adaptado de lexstrategy_sala.html. Los tonos del mobiliario son los del
// mockup; conviven bien con el canvas #08080c de la app.

import {
  ASIENTOS,
  ASIENTO_DEL_USUARIO,
  type RolSala,
} from "@/lib/simulador/sala";
import type { RolUsuarioSimulacion } from "@/lib/types";
import { AsientoSala } from "./asiento-sala";

type Props = {
  rolUsuario: RolUsuarioSimulacion;
  // La querella solo se sienta si la causa la tiene.
  hayQuerellante?: boolean;
  // Quién acaba de hablar. null = nadie iluminado (audiencia sin arrancar).
  activo?: RolSala | null;
  // La sala espera la intervención del abogado.
  esTuTurno?: boolean;
  // Pie del encabezado: órgano y tipo de audiencia.
  descripcion?: string;
};

export function EscenaSala({
  rolUsuario,
  hayQuerellante = false,
  activo = null,
  esTuTurno = false,
  descripcion,
}: Props) {
  const asientoUsuario = ASIENTO_DEL_USUARIO[rolUsuario];
  const conQuerella = hayQuerellante || asientoUsuario === "querellante";
  const asientos = ASIENTOS.filter((a) => !a.opcional || conQuerella).map((a) =>
    // Con querella, la mesa de la acusación se reparte entre dos.
    conQuerella && a.xConQuerella !== undefined ? { ...a, x: a.xConQuerella } : a,
  );

  return (
    <section
      className="shrink-0 border-b border-[var(--el-border-soft)] px-4 pb-1.5 pt-4 md:px-6"
      style={{
        background:
          "radial-gradient(1200px 300px at 50% -40%, #15203a 0%, var(--el-canvas) 70%)",
      }}
      aria-label="Disposición de la sala de audiencias"
    >
      <div className="el-stage-wrap">
        <div className="flex items-center justify-between gap-3 pb-2.5">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--el-text-muted)]">
            La sala
          </span>
          {descripcion ? (
            <span className="truncate text-[12px] text-[var(--el-text-soft)]">
              {descripcion}
            </span>
          ) : null}
        </div>

        <div className="el-stage">
        <svg
          viewBox="0 0 1000 300"
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-0 size-full"
          role="presentation"
          aria-hidden="true"
        >
          {/* piso */}
          <ellipse cx="500" cy="330" rx="520" ry="120" fill="#0e1524" opacity=".7" />

          {/* estrado */}
          <rect x="360" y="70" width="280" height="46" rx="9" fill="#1a2437" />
          <rect x="360" y="70" width="280" height="16" rx="9" fill="#22304a" />
          <text
            x="500"
            y="142"
            textAnchor="middle"
            fill="#33415c"
            fontSize="10"
            letterSpacing="3"
          >
            E S T R A D O
          </text>

          {/* escudo con balanza */}
          <g transform="translate(500,44)">
            <path
              d="M0,-26 L20,-18 L20,4 Q20,20 0,28 Q-20,20 -20,4 L-20,-18 Z"
              fill="#141d2e"
              stroke="var(--el-sala-juez)"
              strokeWidth="1.5"
            />
            <g
              stroke="var(--el-sala-juez)"
              strokeWidth="1.6"
              fill="none"
              strokeLinecap="round"
            >
              <line x1="0" y1="-12" x2="0" y2="10" />
              <line x1="-11" y1="-8" x2="11" y2="-8" />
              <path
                d="M-11,-8 L-15,2 L-7,2 Z"
                fill="var(--el-sala-juez)"
                stroke="none"
                opacity=".85"
              />
              <path
                d="M11,-8 L7,2 L15,2 Z"
                fill="var(--el-sala-juez)"
                stroke="none"
                opacity=".85"
              />
            </g>
          </g>

          {/* mesa de la acusación */}
          <rect x="70" y="205" width="210" height="34" rx="8" fill="#161f30" />
          <rect x="70" y="205" width="210" height="12" rx="8" fill="#1d2a41" />
          <text
            x="175"
            y="258"
            textAnchor="middle"
            fill="#3b4a66"
            fontSize="10.5"
            letterSpacing="1.5"
          >
            MINISTERIO PÚBLICO FISCAL
          </text>

          {/* mesa de la defensa */}
          <rect x="600" y="205" width="300" height="34" rx="8" fill="#161f30" />
          <rect x="600" y="205" width="300" height="12" rx="8" fill="#1d2a41" />
          <text
            x="750"
            y="258"
            textAnchor="middle"
            fill="#3b4a66"
            fontSize="10.5"
            letterSpacing="1.5"
          >
            DEFENSA
          </text>
        </svg>

        {asientos.map((a) => (
          <AsientoSala
            key={a.rol}
            asiento={a}
            activo={activo === a.rol}
            esTuTurno={esTuTurno && a.rol === asientoUsuario}
            esUsuario={a.rol === asientoUsuario}
          />
        ))}
        </div>
      </div>
    </section>
  );
}
