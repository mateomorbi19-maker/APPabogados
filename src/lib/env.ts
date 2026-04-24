import { z } from "zod";

const envSchema = z.object({
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: z.string().min(1),
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: z.string().min(1),
  NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: z.string().min(1),
  NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: z.string().min(1),
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url()
    .refine(
      (v) => !/\/rest\/v1\/?$/.test(v),
      "Debe ser el host raíz (https://<proj>.supabase.co), sin /rest/v1/",
    )
    .refine(
      (v) => !v.endsWith("/"),
      "No debe terminar en '/' (supabase-js lo agrega internamente)",
    ),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n  ");
    throw new Error(
      `Invalid environment variables:\n  ${missing}\n\nRevisá .env.local contra .env.example.`,
    );
  }
  return parsed.data;
}

export const env: Env = parseEnv();
