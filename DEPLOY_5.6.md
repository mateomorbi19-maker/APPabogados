# Deploy 5.6 — primer deploy a Easypanel

**Fecha:** 23 de agosto de 2026
**Qué es:** el primer deploy real de la app nueva, reemplazando el servicio legacy
en `lexstrategy.teotec.org`. **Sin coexistencia**: el legacy se apaga y esta app
ocupa el dominio.

Lo verificado localmente antes de pushear:

| | |
|---|---|
| `npx tsc --noEmit` | limpio |
| `npm run lint` | 28 errores, la misma baseline preexistente de `9db56cb` |
| `npm run build` | `✓ Compiled successfully`, exit 0 |
| Migración `20260822120000` | **aplicada** en la base |
| `scripts/verificar-ficha-causa.ts` | todo verde, exit 0 |
| Saldo de Anthropic | **con crédito** (probado contra `/v1/messages`, HTTP 200) |

---

## 1. Lo que puede romper el deploy

### 1.1 Las claves de Clerk son de DESARROLLO ⚠️

En `.env.local` son `pk_test…` / `sk_test…`. Una instancia **dev** de Clerk está
pensada para localhost: en un dominio real muestra el cartel "Development mode",
usa las credenciales de OAuth compartidas de Clerk (no las nuestras) y su manejo
de sesión no es el de producción.

**Antes de apuntar el dominio hay que:**

1. Crear la **instancia de producción** en el dashboard de Clerk.
2. Agregarle el dominio `lexstrategy.teotec.org` y cargar el **CNAME** que pide
   (`clerk.lexstrategy.teotec.org` y los de correo) en el DNS.
3. Crear credenciales **propias** de Google OAuth (Google Cloud Console) y
   cargarlas en la instancia de producción — la dev usa las de Clerk.
4. Volver a habilitar los scopes de Google que ya usa la app:
   `calendar`, `gmail.modify`, `gmail.send`, `drive.readonly`.
   Ver [SETUP_GOOGLE_BANDEJA_REPOSITORIO.md](SETUP_GOOGLE_BANDEJA_REPOSITORIO.md).
5. Poner `pk_live…` / `sk_live…` en Easypanel.

> Los tres abogados van a tener que **volver a loguearse y re-autorizar** los
> permisos de Google: los tokens de la instancia dev no sirven en la de
> producción. La Agenda, la Bandeja y el Repositorio quedan sin conexión hasta
> que cada uno entre y acepte.

### 1.2 Las `NEXT_PUBLIC_*` van como BUILD ARG, no sólo como env de runtime ⚠️

Next **inlinea** las `NEXT_PUBLIC_*` en el bundle del browser en tiempo de BUILD.
El [Dockerfile](Dockerfile) ya las declara como `ARG`, pero Easypanel tiene que
pasarlas **como build args**, no sólo como variables del contenedor.

Si sólo se setean en runtime, el build las hornea vacías y el síntoma es feo y
mudo: la app levanta, el server anda, y en el browser Clerk y Supabase fallan sin
un error claro. Las que importan:

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
NEXT_PUBLIC_CLERK_SIGN_IN_URL                     = /sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL                     = /sign-in
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL   = /
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL   = /
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

Y las de server (runtime alcanza, pero el Dockerfile también las toma en build):

```
CLERK_SECRET_KEY
SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY
OPENAI_API_KEY
```

`NEXT_PUBLIC_SUPABASE_URL` es **sólo el host**, sin `/rest/v1/` — con el path
`supabase-js` rompe con `PGRST125`.

---

## 2. Lo que NO es un problema

- **La base es la misma que en desarrollo.** Hay un solo proyecto Supabase
  (`xvdlnevcvcsgxbngwliv`), así que la migración de la ficha ya está aplicada para
  producción. No hay orden que respetar entre deploy y SQL.
- **El corpus legal y el Repositorio ya están cargados.** No hay que reingerir
  nada para que la app funcione.
- **El build pasa con `--webpack`.** El Dockerfile ya lo fuerza: Turbopack necesita
  el SWC nativo, que la imagen slim no instala.

---

## 3. Lo que hay que mirar apenas esté arriba

En este orden, porque cada uno depende del anterior:

1. **Entrar y que la sesión funcione.** Si aparece "Development mode", las claves
   siguen siendo las de dev (§1.1).
2. **Abrir una causa.** Debería verse la ficha con "6 datos sin cargar", los tres
   accesos en fila y el badge de etapa. Si tira 500, la migración no está en la
   base que apunta el deploy.
3. **Cargar una carátula y guardar.** Tiene que cambiar el título grande, la lista
   de la izquierda y el Inicio.
4. **⌘K y buscar un número de expediente con puntos y barras.**
5. **Agenda, Bandeja y Repositorio**: van a pedir re-autorizar Google (§1.1).
6. **Un turno de chat o de LEXIE**, que es lo que confirma que la key de Anthropic
   está bien cargada en el contenedor.

---

## 4. Pendientes conocidos que NO bloquean el deploy

- **La ficha no se verificó en un navegador.** Está verificada por tipos, build,
  el script de verificación contra la base y una revisión adversarial del diff
  (11 defectos encontrados y corregidos), pero nadie la vio renderizada. El riesgo
  que queda es visual: tema claro y móvil.
- **145 documentos del Repositorio están en `estado='error'`** (se cortó la ingesta
  cuando la cuenta de Anthropic estaba en cero). Ahora hay saldo: se recuperan con
  `npm run repo:ingesta`, que es incremental (~USD 1,55). Hasta entonces el agente
  cita 155 de 345.
- **La clave pública de Supabase lee el corpus legal entero**, incluidos los
  vectores. Falta el `REVOKE` que sí tienen las tablas nuevas.
- **Fase 9.9** (movimientos del expediente con foja y ámbito) quedó condicionada a
  que el timeline se empiece a usar.
