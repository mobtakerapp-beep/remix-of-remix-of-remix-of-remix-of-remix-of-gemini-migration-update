import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAppAuth } from "@/lib/app-auth-middleware";
import { getRuntimeSecret } from "./runtime-env.server";
import {
  checkGenerationLogCap,
  getSubscriptionStatus,
  logGeneration,
} from "./subscription.server";

const InputSchema = z.object({
  mode: z.enum(["text", "pdf", "image", "youtube"]),
  text: z.string().optional(),
  youtubeUrl: z.string().optional(),
  fileName: z.string().optional(),
  /** data URL, e.g. data:application/pdf;base64,... */
  fileData: z.string().optional(),
  mediaType: z.string().optional(),
  counts: z.object({
    mcq: z.number().int().min(1).max(20),
    trueFalse: z.number().int().min(1).max(20),
    flashcards: z.number().int().min(1).max(20),
  }),
  language: z.enum(["auto", "ar", "en"]).default("auto"),
  numerals: z.enum(["auto", "ar", "en"]).default("auto"),
  grade: z.number().int().min(1).max(12).default(5),
});

export const generateLessonPackage = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .validator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    // Subscription gate: check before generating
    const status = await getSubscriptionStatus(context.supabase, context.userId);
    if (!status.canGenerate) {
      throw new Error(status.plan === "free" ? "limit_reached" : "subscription_expired");
    }

    // Hard daily cap from generation log (protects API keys from abuse)
    const { ok: withinCap, count, cap } = await checkGenerationLogCap(
      context.supabase,
      context.userId,
      status.plan,
    );
    if (!withinCap) {
      throw new Error("daily_log_cap_reached");
    }

    const { buildLessonPackage, resolveAiConfigs } = await import("./lesson.server");
    const providers = resolveAiConfigs();

    let result: Awaited<ReturnType<typeof buildLessonPackage>>;
    if (data.mode === "youtube") {
      const { fetchYoutubeTranscript } = await import("./youtube.server");
      // Direct transcription fallback uses Google Gemini; never send the Lovable key there.
      const transcriptKey = getRuntimeSecret("GEMINI_API_KEY");
      const { title, text } = await fetchYoutubeTranscript(data.youtubeUrl ?? "", transcriptKey);


      const { youtubeUrl: _ignored, ...rest } = data;
      result = await buildLessonPackage(
        { ...rest, mode: "text", text: `${title}\n\n${text}` },
        providers,
      );
    } else {
      const { youtubeUrl: _unused, ...payload } = data;
      result = await buildLessonPackage(payload as never, providers);
    }

    // Log successful generation and bump the subscription counter
    await Promise.all([
      logGeneration(context.supabase, context.userId, data.mode),
      // Keep legacy counter in sync so the subscription status stays accurate
      import("./subscription.server").then(({ incrementGenerationUsage }) =>
        incrementGenerationUsage(context.supabase, context.userId),
      ),
    ]);

    return result;
  });
