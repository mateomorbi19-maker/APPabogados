import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";

// Endpoint temporal de Fase 2 para verificar el lazy-sync Clerk ↔ usuarios.
// Se borra al arrancar Fase 3.
export async function GET() {
  const result = await requireUsuarioOr403();

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.message },
      { status: result.status },
    );
  }

  const { userId } = await auth();
  const user = await currentUser();

  return NextResponse.json({
    ok: true,
    usuario: {
      id: result.usuario_id,
      nombre: result.nombre,
      email: result.email,
    },
    clerk: {
      userId,
      primaryEmail: user?.primaryEmailAddress?.emailAddress ?? null,
    },
  });
}
