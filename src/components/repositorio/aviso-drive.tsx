"use client";
// Qué mostrar cuando el PDF no se puede streamear. La sesión de la app está
// bien: lo que falta es el permiso de Google, así que el CTA es re-loguearse
// (Clerk vuelve a pedir los scopes en el consent) como en la agenda y la
// bandeja — nunca un "no autorizado" a secas.
//
// `view_url` siempre funciona si el usuario tiene acceso a la carpeta del
// estudio, así que es el escape hatch de todos los casos.

import { SignOutButton } from "@clerk/nextjs";
import {
  ExternalLink,
  FileSearch,
  RotateCcw,
  ShieldAlert,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MotivoArchivo } from "./api";

// Sólo los dos motivos de permiso de Google se arreglan volviendo a entrar
// (falta el scope, o el token venció / lo revocaron). Si la cuenta no tiene
// acceso al archivo, o el archivo ya no está, re-loguear no cambia nada.
const ICONO: Record<MotivoArchivo, LucideIcon> = {
  sin_token: ShieldAlert,
  token_invalido: ShieldAlert,
  sin_permiso: ShieldAlert,
  no_encontrado: FileSearch,
  error_drive: TriangleAlert,
  tipo_cambiado: FileSearch,
};

const RELOGUEAR: readonly MotivoArchivo[] = ["sin_token", "token_invalido"];

type Props = {
  error: string;
  motivo: MotivoArchivo | null;
  viewUrl: string | null;
  onReintentar?: () => void;
};

export function AvisoDrive({ error, motivo, viewUrl, onReintentar }: Props) {
  const Icono = motivo ? ICONO[motivo] : TriangleAlert;
  const puedeReloguear = motivo !== null && RELOGUEAR.includes(motivo);
  const puedeReintentar = motivo === "error_drive" || motivo === null;

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center rounded-xl border border-[rgba(251,191,36,0.28)] bg-[rgba(251,191,36,0.06)] px-6 py-12 text-center">
      <Icono className="size-8 text-amber-700 dark:text-[#fcd34d]" aria-hidden />
      <h2 className="mt-3 font-display text-base font-semibold text-amber-800 dark:text-[#fde68a]">
        No se puede abrir el PDF acá adentro
      </h2>
      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-[var(--el-text-soft)]">
        {error}
      </p>
      {puedeReloguear ? (
        <p className="mt-1 max-w-md text-xs leading-relaxed text-[var(--el-text-muted)]">
          Volvé a iniciar sesión con Google y aceptá el permiso de lectura de
          Drive. Mientras tanto podés abrir el archivo directamente en Drive.
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {puedeReloguear ? (
          <SignOutButton redirectUrl="/sign-in">
            <Button aria-label="Volver a iniciar sesión para autorizar Google Drive">
              Autorizar Google Drive
            </Button>
          </SignOutButton>
        ) : null}
        {viewUrl ? (
          <a
            href={viewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            <ExternalLink aria-hidden />
            Abrir en Drive
          </a>
        ) : null}
        {puedeReintentar && onReintentar ? (
          <Button variant="outline" onClick={onReintentar}>
            <RotateCcw aria-hidden />
            Reintentar
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Versión banner para la lista: el catálogo se explora igual sin permiso de
 * Drive — lo único que se cae es abrir el PDF adentro de la app.
 */
export function BannerDrive({ vinculado }: { vinculado: boolean }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[rgba(251,191,36,0.28)] bg-[rgba(251,191,36,0.07)] px-4 py-3 md:flex-row md:items-center">
      <ShieldAlert className="size-5 shrink-0 text-amber-700 dark:text-[#fcd34d]" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-semibold text-amber-800 dark:text-[#fde68a]">
          Podés explorar toda la biblioteca, pero no abrir los PDF acá adentro
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-[var(--el-text-soft)]">
          {vinculado
            ? "Tu cuenta de Google está vinculada, pero falta autorizar el acceso a Drive. Volvé a iniciar sesión y aceptá el permiso de lectura."
            : "Falta vincular tu cuenta de Google y autorizar el acceso a Drive. Volvé a iniciar sesión con Google y aceptá el permiso de lectura."}
        </p>
      </div>
      <SignOutButton redirectUrl="/sign-in">
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 self-start md:self-auto"
          aria-label="Volver a iniciar sesión para autorizar Google Drive"
        >
          Autorizar Drive
        </Button>
      </SignOutButton>
    </div>
  );
}
