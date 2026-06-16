-- Pull incremental Google Calendar → app (syncToken).
-- Hasta ahora la sync era unidireccional (app → Google). Esto agrega el camino
-- de vuelta: un PULL que lee cambios hechos DENTRO de Google y los refleja en
-- la app (update-only sobre eventos ya conocidos; delete si vienen cancelados).

-- a) Token de sync incremental por usuario. user_id = usuarios.id (UUID) como
--    text. 1 fila por usuario. sync_token nullable (NULL = hacer full sync).
create table if not exists google_calendar_sync (
  user_id     text primary key,
  calendar_id text not null default 'primary',
  sync_token  text,
  updated_at  timestamptz not null default now()
);

-- RLS deny-by-default, igual que el resto del modelo Clerk-only: el server
-- accede con service_role (bypassa policies); no hay acceso anon/authenticated.
alter table google_calendar_sync enable row level security;

-- b) 'updated' de Google por evento, para el control de conflicto del pull:
--    Google gana en fecha/hora SOLO si su `updated` es más nuevo que el
--    guardado (o si es NULL, p.ej. eventos previos a esta feature).
alter table eventos_agenda add column if not exists google_updated timestamptz;
