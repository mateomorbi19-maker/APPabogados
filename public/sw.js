// Service worker de EstrategiaLegal.
//
// === Por qué NO cachea nada ===
//
// Chrome exige un service worker con handler de `fetch` para ofrecer
// "Instalar" en Android. Ese es el único motivo por el que este archivo
// existe, y por eso hace lo mínimo indispensable.
//
// Cachear sería activamente peligroso acá: cada página de esta app está detrás
// de Clerk y muestra expedientes penales de UN abogado. Un service worker que
// guarde respuestas puede servirle a alguien una vista renderizada para otra
// sesión, o dejar en el disco del dispositivo el relato de una causa después
// de cerrar sesión. Para tres usuarios que trabajan siempre online, el
// beneficio de la caché no compensa ni de lejos ese riesgo.
//
// Entonces: solo se interceptan las NAVEGACIONES, se dejan pasar tal cual, y
// si la red falla se muestra un cartel de sin conexión en vez del dinosaurio
// del navegador. Nada se guarda.

const VERSION = "el-v1";

self.addEventListener("install", (event) => {
  // Activa esta versión sin esperar a que se cierren las pestañas viejas.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Barre cualquier caché que haya dejado una versión anterior de este
      // archivo. Si en el futuro alguien agrega caché y después se arrepiente,
      // esto la limpia sola.
      const nombres = await caches.keys();
      await Promise.all(nombres.map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

const OFFLINE_HTML = `<!doctype html>
<html lang="es-AR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sin conexión — EstrategiaLegal</title>
<style>
  html,body{height:100%;margin:0}
  body{display:grid;place-items:center;background:#08080c;color:#f5f5f8;
       font-family:system-ui,-apple-system,Segoe UI,sans-serif;text-align:center;padding:2rem}
  h1{font-size:1.125rem;font-weight:600;margin:0 0 .5rem}
  p{font-size:.875rem;color:#a2a2b2;margin:0;line-height:1.5;max-width:22rem}
  .m{font-size:1.75rem;font-weight:700;margin-bottom:1rem}
  .m span{color:#a78bfa}
</style></head>
<body><div>
  <div class="m">E<span>L</span></div>
  <h1>Sin conexión</h1>
  <p>EstrategiaLegal necesita internet para trabajar: los expedientes y la agenda viven en el servidor, no en el teléfono. Volvé a intentar cuando tengas señal.</p>
</div></body></html>`;

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Solo navegaciones. Todo lo demás (API, assets, imágenes) va derecho a la
  // red sin que el service worker lo toque.
  if (req.mode !== "navigate") return;

  event.respondWith(
    fetch(req).catch(
      () =>
        new Response(OFFLINE_HTML, {
          status: 503,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
    ),
  );
});
