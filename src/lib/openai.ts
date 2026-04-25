import "server-only";
import OpenAI from "openai";
import { env } from "@/lib/env";

let cached: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (cached) return cached;
  cached = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return cached;
}

export const EMBEDDING_MODEL = "text-embedding-3-small" as const;
