"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useUser } from "@clerk/nextjs";
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
import { Camera, Check, Loader2, Monitor, Moon, Palette, Sparkles, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TEMA_META, TEMAS, type Tema } from "@/components/tema/tema";
import { useTema } from "@/components/tema/tema-provider";
import { cn } from "@/lib/utils";
import { AvatarUsuario, escucharAbrirCuenta, useIdentidad, type SeccionCuenta } from "./identidad";

// Diálogo «Tu cuenta»: lo abre el menú de cuenta (abajo a la izquierda) en la
// sección elegida. Está montado una sola vez en el shell y se abre por evento
// de window, así el drawer móvil puede cerrarse sin llevarse el diálogo puesto.

const SECCIONES: { id: SeccionCuenta; label: string; icono: typeof Palette }[] = [
  { id: "apariencia", label: "Apariencia", icono: Palette },
  { id: "datos", label: "Datos personales", icono: UserRound },
  { id: "plan", label: "Mi plan", icono: Sparkles },
];

export function CuentaDialog({ nombreUsuario }: { nombreUsuario: string }) {
  const [abierto, setAbierto] = useState(false);
  const [seccion, setSeccion] = useState<SeccionCuenta>("apariencia");

  useEffect(
    () =>
      escucharAbrirCuenta((s) => {
        setSeccion(s);
        setAbierto(true);
      }),
    [],
  );

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:h-[460px] sm:max-w-2xl">
        <div className="flex min-h-0 flex-col sm:h-full sm:flex-row">
          <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-border p-2 pr-12 sm:w-52 sm:flex-col sm:border-r sm:border-b-0 sm:p-3">
            <DialogTitle className="sr-only sm:not-sr-only sm:px-2 sm:pt-1 sm:pb-3 sm:text-base sm:font-semibold">
              Tu cuenta
            </DialogTitle>
            {SECCIONES.map(({ id, label, icono: Icono }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSeccion(id)}
                aria-current={seccion === id ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm whitespace-nowrap transition-colors",
                  seccion === id
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <Icono className="size-4 shrink-0" />
                {label}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
            {seccion === "apariencia" ? <Apariencia /> : null}
            {seccion === "datos" ? <DatosPersonales nombreUsuario={nombreUsuario} /> : null}
            {seccion === "plan" ? <MiPlan /> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Encabezado({ titulo, bajada }: { titulo: string; bajada?: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-base font-semibold">{titulo}</h2>
      {bajada ? <p className="mt-1 text-sm text-muted-foreground">{bajada}</p> : null}
    </div>
  );
}

// ——— Apariencia (lo que antes era el diálogo del engranaje) ———

const ICONO_TEMA: Record<Tema, typeof Moon> = {
  oscuro: Moon,
  sistema: Monitor,
};

function Apariencia() {
  const { tema, setTema } = useTema();
  return (
    <section>
      <Encabezado
        titulo="Apariencia"
        bajada="El Mapa procesal y el Simulador de audiencias se ven siempre en oscuro: su diseño está hecho sobre fondo negro."
      />
      <div role="radiogroup" aria-label="Tema de la aplicación" className="space-y-2">
        {TEMAS.map((t) => {
          const Icono = ICONO_TEMA[t];
          const activo = tema === t;
          return (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={activo}
              onClick={() => setTema(t)}
              className={cn(
                "flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                activo ? "border-primary/60 bg-primary/10" : "border-border hover:bg-muted/60",
              )}
            >
              <Icono
                className={cn(
                  "mt-0.5 size-[18px] shrink-0",
                  activo ? "text-primary" : "text-muted-foreground",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{TEMA_META[t].label}</span>
                <span className="block text-xs leading-relaxed text-muted-foreground">
                  {TEMA_META[t].descripcion}
                </span>
              </span>
              {activo ? <Check className="mt-0.5 size-4 shrink-0 text-primary" /> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ——— Datos personales: nombre y foto, guardados en Clerk ———

const MAX_FOTO_BYTES = 10 * 1024 * 1024;

function mensajeError(e: unknown): string {
  if (isClerkAPIResponseError(e)) {
    return e.errors[0]?.longMessage ?? e.errors[0]?.message ?? "No se pudo guardar.";
  }
  return "No se pudo guardar. Probá de nuevo.";
}

function DatosPersonales({ nombreUsuario }: { nombreUsuario: string }) {
  const { isLoaded } = useUser();
  const { user, nombre, email, imagen } = useIdentidad(nombreUsuario);
  if (!isLoaded || !user) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Cargando…
      </div>
    );
  }
  // `key`: si la cuenta cambia, el formulario arranca de nuevo con sus datos.
  return (
    <FormDatos
      key={user.id}
      user={user}
      nombreVisible={nombre}
      email={email}
      imagen={imagen}
    />
  );
}

function FormDatos({
  user,
  nombreVisible,
  email,
  imagen,
}: {
  user: NonNullable<ReturnType<typeof useUser>["user"]>;
  nombreVisible: string;
  email: string | null;
  imagen: string | null;
}) {
  const [nombre, setNombre] = useState(user.firstName ?? "");
  const [apellido, setApellido] = useState(user.lastName ?? "");
  const [guardando, setGuardando] = useState(false);
  const [foto, setFoto] = useState<"subiendo" | "quitando" | null>(null);
  const inputFoto = useRef<HTMLInputElement>(null);

  const cambio =
    nombre.trim() !== (user.firstName ?? "") || apellido.trim() !== (user.lastName ?? "");

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) {
      toast.error("El nombre no puede quedar vacío.");
      return;
    }
    setGuardando(true);
    try {
      await user.update({ firstName: nombre.trim(), lastName: apellido.trim() });
      toast.success("Datos guardados");
    } catch (err) {
      toast.error(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarFoto(file: File | undefined) {
    if (inputFoto.current) inputFoto.current.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Elegí una imagen (JPG, PNG o WebP).");
      return;
    }
    if (file.size > MAX_FOTO_BYTES) {
      toast.error("La imagen pesa más de 10 MB.");
      return;
    }
    setFoto("subiendo");
    try {
      await user.setProfileImage({ file });
      await user.reload();
      toast.success("Foto actualizada");
    } catch (err) {
      toast.error(mensajeError(err));
    } finally {
      setFoto(null);
    }
  }

  async function quitarFoto() {
    setFoto("quitando");
    try {
      await user.setProfileImage({ file: null });
      await user.reload();
      toast.success("Foto quitada");
    } catch (err) {
      toast.error(mensajeError(err));
    } finally {
      setFoto(null);
    }
  }

  return (
    <section>
      <Encabezado titulo="Datos personales" bajada="Así te ve la app en el menú de tu cuenta." />

      <div className="mb-6 flex items-center gap-4">
        <div className="relative">
          <AvatarUsuario nombre={nombreVisible} imagen={imagen} className="size-16 text-2xl" />
          {foto ? (
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
              <Loader2 className="size-5 animate-spin text-white" />
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={inputFoto}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => void cambiarFoto(e.target.files?.[0])}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={foto !== null}
            onClick={() => inputFoto.current?.click()}
          >
            <Camera /> Cambiar foto
          </Button>
          {imagen ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={foto !== null}
              onClick={() => void quitarFoto()}
            >
              Quitar
            </Button>
          ) : null}
        </div>
      </div>

      <form onSubmit={guardar} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cuenta-nombre">Nombre</Label>
            <Input
              id="cuenta-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              autoComplete="given-name"
              maxLength={60}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cuenta-apellido">Apellido</Label>
            <Input
              id="cuenta-apellido"
              value={apellido}
              onChange={(e) => setApellido(e.target.value)}
              autoComplete="family-name"
              maxLength={60}
            />
          </div>
        </div>
        {email ? (
          <div className="space-y-1.5">
            <Label htmlFor="cuenta-email">Correo</Label>
            <Input id="cuenta-email" value={email} disabled readOnly />
            <p className="text-xs text-muted-foreground">
              Es el de tu cuenta de Google y no se cambia desde acá.
            </p>
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">
          La firma de los escritos usa tu perfil profesional, que se completa al generar un escrito.
        </p>
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={!cambio || guardando}>
            {guardando ? <Loader2 className="animate-spin" /> : null}
            Guardar cambios
          </Button>
        </div>
      </form>
    </section>
  );
}

// ——— Mi plan ———

function MiPlan() {
  return (
    <section>
      <Encabezado titulo="Mi plan" />
      <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-10 text-center">
        <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Sparkles className="size-5" />
        </span>
        <span className="mb-2 rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary">
          Próximamente
        </span>
        <p className="max-w-sm text-sm text-muted-foreground">
          Muy pronto vas a poder contratar distintos planes de uso de EstrategiaLegal.
        </p>
      </div>
    </section>
  );
}
