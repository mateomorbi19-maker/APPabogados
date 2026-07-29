import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CATALOGO } from "@/lib/repositorio/catalogo";
import { documentoPorId } from "@/lib/repositorio/buscar";
import { COLECCIONES } from "@/lib/repositorio/types";
import { LectorDocumento } from "@/components/repositorio/lector-documento";

// Mismo formato de id que valida el endpoint del archivo (slug del título).
const ID_RE = /^[a-z0-9-]{1,80}$/;

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const doc = ID_RE.test(id) ? documentoPorId(CATALOGO, id) : null;
  if (!doc) return { title: "Documento · EstrategiaLegal" };
  return {
    title: `${doc.titulo} · Repositorio`,
    description: COLECCIONES[doc.coleccion].descripcion,
  };
}

// La auth y el shell los resuelve layout.tsx. El catálogo es un módulo en
// memoria: buscar el documento no toca ni la DB ni la red.
export default async function DocumentoPage({ params }: Params) {
  const { id } = await params;
  if (!ID_RE.test(id)) notFound();

  const doc = documentoPorId(CATALOGO, id);
  if (!doc) notFound();

  return <LectorDocumento doc={doc} />;
}
