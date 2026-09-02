import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAppAuth } from "@/lib/app-auth-middleware";
import type { LessonPackage } from "./lesson-types";

const PackageSchema = z.record(z.string(), z.unknown());

function makeToken() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 22);
}

export const createShare = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .validator((input: unknown) =>
    z.object({ title: z.string().min(1).max(200), package: PackageSchema }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ token: string }> => {
    const token = makeToken();
    const { error } = await context.supabase.from("lesson_shares" as never).insert({
      user_id: context.userId,
      title: data.title,
      package: data.package,
      token,
    } as never);
    if (error) throw new Error(error.message);
    return { token };
  });

export const getSharedLesson = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ token: z.string().min(6).max(64) }).parse(input))
  .handler(async ({ data }): Promise<{ title: string; package: LessonPackage }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("lesson_shares" as never)
      .select("title, package")
      .eq("token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("not_found");
    const r = row as unknown as Record<string, unknown>;
    return { title: String(r["title"]), package: r["package"] as LessonPackage };
  });

const AnswerSchema = z.object({
  prompt: z.string().max(600),
  picked: z.string().max(300),
  correct: z.string().max(300),
  isCorrect: z.boolean(),
});

export type ShareResult = {
  id: string;
  shareToken: string;
  studentName: string;
  score: number;
  total: number;
  answers: z.infer<typeof AnswerSchema>[];
  createdAt: string;
};

/** Public: a student submits their score from a shared link (no login needed). */
export const submitShareResult = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        token: z.string().min(6).max(64),
        studentName: z.string().min(1).max(60),
        score: z.number().int().min(0).max(1000),
        total: z.number().int().min(0).max(1000),
        answers: z.array(AnswerSchema).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env["SUPABASE_URL"] || import.meta.env["VITE_SUPABASE_URL"];
    const key =
      process.env["SUPABASE_PUBLISHABLE_KEY"] || import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
    if (!url || !key) throw new Error("Backend configuration is unavailable");
    const client = createClient(url, key, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          const headers = new Headers(init?.headers);
          if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
            headers.delete("Authorization");
          }
          headers.set("apikey", key);
          return fetch(input, { ...init, headers });
        },
      },
    });
    const { error } = await client.from("lesson_share_results" as never).insert({
      share_token: data.token,
      student_name: data.studentName.trim(),
      score: data.score,
      total: data.total,
      answers: data.answers,
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type ShareWithResults = {
  token: string;
  title: string;
  createdAt: string;
  results: ShareResult[];
};

/** Owner-only: every share the teacher created plus the students who played it. */
export const listShareResults = createServerFn({ method: "GET" })
  .middleware([requireAppAuth])
  .handler(async ({ context }): Promise<ShareWithResults[]> => {
    const { data: shares, error } = await context.supabase
      .from("lesson_shares" as never)
      .select("token, title, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const rows = (shares ?? []) as unknown as Record<string, unknown>[];
    if (!rows.length) return [];

    const tokens = rows.map((r) => String(r["token"]));
    const { data: results, error: rErr } = await context.supabase
      .from("lesson_share_results" as never)
      .select("id, share_token, student_name, score, total, answers, created_at")
      .in("share_token", tokens)
      .order("created_at", { ascending: false });
    if (rErr) throw new Error(rErr.message);
    const all = ((results ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      id: String(r["id"]),
      shareToken: String(r["share_token"]),
      studentName: String(r["student_name"]),
      score: Number(r["score"] ?? 0),
      total: Number(r["total"] ?? 0),
      answers: (r["answers"] as ShareResult["answers"]) ?? [],
      createdAt: String(r["created_at"]),
    }));

    return rows.map((r) => ({
      token: String(r["token"]),
      title: String(r["title"]),
      createdAt: String(r["created_at"]),
      results: all.filter((x) => x.shareToken === String(r["token"])),
    }));
  });

/** Owner-only: delete a single student result from one of the teacher's shares. */
export const deleteShareResult = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .validator((input: unknown) => z.object({ resultId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    // Verify the result belongs to a share owned by this teacher before deleting.
    const { data: shares, error: shareErr } = await context.supabase
      .from("lesson_shares" as never)
      .select("token")
      .eq("user_id", context.userId);
    if (shareErr) throw new Error(shareErr.message);
    const tokens = ((shares ?? []) as unknown as Record<string, unknown>[]).map((r) =>
      String(r["token"]),
    );

    const { data: rows, error: findErr } = await context.supabase
      .from("lesson_share_results" as never)
      .select("id")
      .eq("id", data.resultId)
      .in("share_token", tokens)
      .maybeSingle();
    if (findErr) throw new Error(findErr.message);
    if (!rows) throw new Error("not_found_or_unauthorized");

    const { error } = await context.supabase
      .from("lesson_share_results" as never)
      .delete()
      .eq("id", data.resultId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
