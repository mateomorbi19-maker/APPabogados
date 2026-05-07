// Vista del chat continuo con el agente sobre un caso. Server component:
// valida ownership, resuelve qué conversación mostrar (la activa o la
// específica del query param `?conv=<uuid>`), y carga sus mensajes.
//
// Lazy-init: si el caso no tiene conversación activa, creamos una vacía
// automáticamente con título auto-fecha. Es la primera vez que el
// abogado abre el chat para este caso o todas las anteriores están
// archivadas.

import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { createServerClient } from "@/lib/supabase/server";
import { ChatShell } from "@/components/mis-casos/chat/chat-shell";
import type {
  Caso,
  Conversacion,
  MensajeConversacion,
} from "@/lib/types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FECHA_AR = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "America/Argentina/Buenos_Aires",
});
const HORA_AR = new Intl.DateTimeFormat("es-AR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "America/Argentina/Buenos_Aires",
});

const searchSchema = z.object({
  conv: z.string().uuid().optional(),
});

async function resolverTituloDefault(
  supabase: ReturnType<typeof createServerClient>,
  casoId: string,
): Promise<string> {
  const ahora = new Date();
  const fechaCorta = FECHA_AR.format(ahora);
  const tituloBase = `Conversación del ${fechaCorta}`;
  const { data: existentes } = await supabase
    .from("conversaciones_caso")
    .select("id")
    .eq("caso_id", casoId)
    .eq("titulo", tituloBase)
    .limit(1);
  if (existentes && existentes.length > 0) {
    return `${tituloBase} ${HORA_AR.format(ahora)}`;
  }
  return tituloBase;
}

export default async function CasoChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id: casoId } = await params;
  const sp = await searchParams;
  if (!UUID_RE.test(casoId)) notFound();

  const auth = await requireUsuarioOr403();
  if (!auth.ok) notFound();

  const supabase = createServerClient();

  // Caso pertenece al usuario.
  const { data: caso, error: casoErr } = await supabase
    .from("casos")
    .select(
      "id, usuario_id, titulo, caso_descripcion, contexto, rol, ejecucion_origen_id, estrategia_seleccionada_rol, estrategia_seleccionada_idx, estrategia_snapshot, creado_en, actualizado_en",
    )
    .eq("id", casoId)
    .eq("usuario_id", auth.usuario_id)
    .maybeSingle();
  if (casoErr || !caso) notFound();

  const parsedSp = searchSchema.safeParse({
    conv: typeof sp.conv === "string" ? sp.conv : undefined,
  });
  const convPedida = parsedSp.success ? parsedSp.data.conv : undefined;

  // Lista de conversaciones del caso.
  const { data: convs } = await supabase
    .from("conversaciones_caso")
    .select(
      "id, caso_id, titulo, estado, creada_en, actualizada_en, archivada_en",
    )
    .eq("caso_id", casoId)
    .order("estado", { ascending: true })
    .order("creada_en", { ascending: false });
  const conversaciones = (convs ?? []) as Conversacion[];

  // Resolución de qué conversación mostrar:
  //   1. Si vino conv en query y existe + pertenece al caso, usar esa.
  //   2. Si no, usar la activa.
  //   3. Si no hay activa, crearla (auto-init).
  let conversacionActual: Conversacion | null = null;
  if (convPedida) {
    conversacionActual =
      conversaciones.find((c) => c.id === convPedida) ?? null;
    if (!conversacionActual) notFound();
  } else {
    conversacionActual =
      conversaciones.find((c) => c.estado === "activa") ?? null;
  }

  if (!conversacionActual) {
    // Lazy init: crear conversación activa nueva.
    const tituloAuto = await resolverTituloDefault(supabase, casoId);
    const { data: insertada, error: insErr } = await supabase
      .from("conversaciones_caso")
      .insert({ caso_id: casoId, titulo: tituloAuto, estado: "activa" })
      .select(
        "id, caso_id, titulo, estado, creada_en, actualizada_en, archivada_en",
      )
      .single();
    if (insErr || !insertada) {
      console.error("[chat page] lazy init error:", insErr);
      notFound();
    }
    conversacionActual = insertada as Conversacion;
    conversaciones.unshift(conversacionActual);
  }

  // Mensajes de la conversación elegida.
  const { data: msgs } = await supabase
    .from("mensajes_conversacion")
    .select(
      "id, conversacion_id, rol, contenido, adjuntos, respuesta_estructurada, ejecucion_id, creado_en",
    )
    .eq("conversacion_id", conversacionActual.id)
    .order("creado_en", { ascending: true });
  const mensajes = (msgs ?? []) as MensajeConversacion[];

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border bg-card/50 sticky top-0 z-10 backdrop-blur">
        <div className="container max-w-5xl mx-auto px-4 py-2 flex items-center gap-3">
          <Link
            href={`/dashboard/mis-casos/${casoId}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-4" />
            Volver al caso
          </Link>
          <span className="text-muted-foreground">·</span>
          <span className="text-sm font-medium truncate">
            {(caso as Caso).titulo}
          </span>
        </div>
      </header>

      <main className="flex-1 flex flex-col">
        <div className="container max-w-5xl mx-auto px-4 py-4 flex-1 flex flex-col w-full">
          <ChatShell
            casoId={casoId}
            conversacionInicial={conversacionActual}
            mensajesIniciales={mensajes}
            conversaciones={conversaciones}
          />
        </div>
      </main>
    </div>
  );
}
