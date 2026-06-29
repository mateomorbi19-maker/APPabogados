# ---- Stage 1: deps ----
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- Stage 2: builder ----
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_CLERK_SIGN_IN_URL
ARG NEXT_PUBLIC_CLERK_SIGN_UP_URL
ARG NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL
ARG NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG CLERK_SECRET_KEY
ARG SUPABASE_SERVICE_ROLE_KEY
ARG ANTHROPIC_API_KEY
ARG OPENAI_API_KEY
ENV NEXT_TELEMETRY_DISABLED=1
# Headroom de heap para el type-check de `next build`: el builder de Easypanel
# tiene RAM acotada y V8 se auto-limitaba en ~2 GB (heap OOM en "Running
# TypeScript"). 4 GB le da margen sin depender solo del tamaño del default.
ENV NODE_OPTIONS=--max-old-space-size=4096

# --webpack: Next 16 buildea con Turbopack por defecto, y Turbopack REQUIERE el
# binario nativo de SWC. En esta imagen slim el SWC nativo de Linux no se instala
# (npm cae al WASM), y Turbopack no corre sobre WASM ("native bindings are not
# available"). Webpack sí buildea con el SWC WASM (más lento, pero funciona). En
# local hay binario nativo, así que `next dev`/`next build` siguen con Turbopack.
RUN npm run build -- --webpack

# ---- Stage 3: runner ----
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid 1001 --no-create-home nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
