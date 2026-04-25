import "server-only";

export function jsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}
