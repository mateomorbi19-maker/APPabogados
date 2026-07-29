"use client";
// Banner de estado de la conexión con Gmail. Mismo criterio que
// google-calendar-status de la agenda: la reconexión se resuelve saliendo y
// volviendo a entrar con Google (Clerk pide de nuevo los scopes en el consent),
// así que el CTA es un <SignOutButton/>.

import { SignOutButton } from "@clerk/nextjs";
import { AlertTriangle, MailWarning, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EstadoConexion } from "./api";

type Props = { estado: EstadoConexion | null };

export function BannerConexion({ estado }: Props) {
  // Mientras se verifica no mostramos nada: un banner que aparece y desaparece
  // en 200ms es peor que ninguno.
  if (estado === null) return null;

  if (!estado.conectado) {
    return (
      <div className="border-b border-[rgba(251,191,36,0.28)] bg-[rgba(251,191,36,0.08)]">
        <div className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:gap-4 md:px-6">
          <MailWarning className="size-5 shrink-0 text-[#fcd34d]" />
          <div className="min-w-0 flex-1">
            <p className="font-display text-sm font-semibold text-[#fde68a]">
              La conexión con Gmail todavía no está habilitada
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--el-text-soft)]">
              {estado.vinculado
                ? "Tu cuenta de Google está vinculada, pero falta autorizar el acceso a Gmail. Volvé a iniciar sesión y aceptá el permiso de correo."
                : "Falta vincular tu cuenta de Google y autorizar el acceso a Gmail. Volvé a iniciar sesión con Google y aceptá el permiso de correo."}
            </p>
          </div>
          <SignOutButton redirectUrl="/sign-in">
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 self-start md:self-auto"
              aria-label="Volver a iniciar sesión para autorizar el acceso a Gmail"
            >
              Autorizar Gmail
            </Button>
          </SignOutButton>
        </div>

        {/* Segunda línea, deliberadamente redundante: nadie tiene que poder
            confundir un mail de ejemplo con uno real. */}
        <div className="flex items-center gap-2 border-t border-[rgba(251,191,36,0.2)] bg-[rgba(251,191,36,0.06)] px-4 py-1.5 md:px-6">
          <AlertTriangle className="size-3.5 shrink-0 text-[#fcd34d]" />
          <p className="text-[11px] leading-tight text-[#fcd34d]">
            Todo lo que se ve abajo son <strong>datos de ejemplo</strong>: ningún
            mensaje, remitente ni expediente es real.
          </p>
        </div>
      </div>
    );
  }

  if (!estado.puede_enviar) {
    return (
      <div className="flex items-center gap-3 border-b border-[rgba(96,165,250,0.28)] bg-[rgba(96,165,250,0.08)] px-4 py-2.5 md:px-6">
        <ShieldAlert className="size-4 shrink-0 text-[#93c5fd]" />
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-[var(--el-text-soft)]">
          Estás leyendo tu correo real, pero falta el permiso para{" "}
          <strong className="text-[var(--el-text)]">enviar</strong>. Volvé a
          iniciar sesión aceptando ese permiso para poder responder.
        </p>
        <SignOutButton redirectUrl="/sign-in">
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            aria-label="Volver a iniciar sesión para autorizar el envío de correos"
          >
            Autorizar envío
          </Button>
        </SignOutButton>
      </div>
    );
  }

  return null;
}
