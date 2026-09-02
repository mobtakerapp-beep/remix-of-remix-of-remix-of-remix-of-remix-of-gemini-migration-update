/**
 * Single source of truth for AI model names.
 *
 * Google retires Gemini model aliases regularly (2.5-flash -> 2.0-flash -> 3.6-flash).
 * When that happens, change it HERE only — every provider path reads these values.
 * The `*_MODEL` secrets allow overriding without a redeploy.
 */

export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
export const DEFAULT_OPENROUTER_MODEL = "google/gemini-3.6-flash";
export const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";

/** REST endpoint for a direct (non-OpenAI-compatible) Gemini generateContent call. */
export function geminiGenerateUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

/** OpenAI-compatible base URL for Gemini. */
export const GEMINI_OPENAI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/";
