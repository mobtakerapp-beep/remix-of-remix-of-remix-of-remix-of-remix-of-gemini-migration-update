import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowDownAZ,
  ArrowUpZA,
  CheckCircle2,
  Download,
  Home,
  Loader2,
  Search,
  Trash2,
  Trophy,
  XCircle,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import {
  deleteShareResult,
  listShareResults,
  type ShareResult,
  type ShareWithResults,
} from "@/lib/shares.functions";

export const Route = createFileRoute("/results")({
  head: () => ({
    meta: [
      { title: "نتائج الطلبة — مولّد الدروس الذكي" },
      { name: "description", content: "اعرض أسماء الطلبة الذين حلّوا دروسك ودرجاتهم وإجاباتهم." },
      { property: "og:title", content: "نتائج الطلبة" },
      { property: "og:description", content: "درجات الطلبة وإجاباتهم على الدروس المشتركة." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ResultsPage,
});

type SortKey = "date" | "score";
type SortDir = "desc" | "asc";

function ResultsPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const navigate = useNavigate();
  const fetchResults = useServerFn(listShareResults);
  const removeResult = useServerFn(deleteShareResult);
  const [shares, setShares] = useState<ShareWithResults[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        navigate({ to: "/auth" });
        return;
      }
      try {
        setShares(await fetchResults({ data: undefined } as never));
      } catch {
        toast.error(ar ? "فشل تحميل النتائج" : "Failed to load results");
      } finally {
        setLoading(false);
      }
    })();
  }, [fetchResults, navigate, ar]);

  const filteredShares = useMemo(() => {
    const q = query.trim().toLowerCase();
    return shares.map((s) => ({
      ...s,
      results: s.results
        .filter((r) => r.studentName.toLowerCase().includes(q))
        .sort((a, b) => {
          if (sortKey === "score") {
            const sa = a.total ? a.score / a.total : 0;
            const sb = b.total ? b.score / b.total : 0;
            return sortDir === "desc" ? sb - sa : sa - sb;
          }
          const da = new Date(a.createdAt).getTime();
          const db = new Date(b.createdAt).getTime();
          return sortDir === "desc" ? db - da : da - db;
        }),
    }));
  }, [shares, query, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const totalStudents = useMemo(
    () => filteredShares.reduce((sum, s) => sum + s.results.length, 0),
    [filteredShares],
  );
  const avgScore = useMemo(() => {
    let total = 0;
    let scored = 0;
    filteredShares.forEach((s) =>
      s.results.forEach((r) => {
        if (r.total) {
          total += r.score / r.total;
          scored += 1;
        }
      }),
    );
    return scored ? Math.round((total / scored) * 100) : 0;
  }, [filteredShares]);

  /** Most frequently missed questions across all visible shares. */
  const missedQuestions = useMemo(() => {
    const map = new Map<
      string,
      { prompt: string; wrong: number; total: number; shareTitle: string }
    >();
    filteredShares.forEach((s) => {
      s.results.forEach((r) => {
        r.answers.forEach((a) => {
          if (!a.prompt) return;
          const key = `${s.title}::${a.prompt}`;
          const entry = map.get(key) ?? { prompt: a.prompt, wrong: 0, total: 0, shareTitle: s.title };
          entry.total += 1;
          if (!a.isCorrect) entry.wrong += 1;
          map.set(key, entry);
        });
      });
    });
    return Array.from(map.values())
      .filter((x) => x.wrong > 0)
      .sort((a, b) => b.wrong - a.wrong)
      .slice(0, 5);
  }, [filteredShares]);

  const exportCsv = () => {
    const rows: (string | number)[][] = [
      [ar ? "الدرس" : "Lesson", ar ? "اسم الطالب" : "Student", ar ? "الدرجة" : "Score", ar ? "الإجمالي" : "Total", ar ? "النسبة" : "%", ar ? "التاريخ" : "Date"],
    ];
    filteredShares.forEach((s) =>
      s.results.forEach((r) => {
        rows.push([
          s.title,
          r.studentName,
          r.score,
          r.total,
          r.total ? Math.round((r.score / r.total) * 100) : 0,
          new Date(r.createdAt).toLocaleString(ar ? "ar-EG" : "en-GB"),
        ]);
      }),
    );
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `results-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(ar ? "تم تنزيل الملف" : "CSV downloaded");
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(ar ? "هل تريد حذف هذه النتيجة؟ لا يمكن التراجع." : "Delete this result?")) return;
    setDeleting(id);
    try {
      await removeResult({ data: { resultId: id } });
      setShares((prev) =>
        prev.map((s) => ({
          ...s,
          results: s.results.filter((r) => r.id !== id),
        })),
      );
      toast.success(ar ? "تم الحذف" : "Deleted");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "";
      if (/unauthorized|401/i.test(msg)) {
        toast.error(ar ? "انتهت الجلسة، سجّلي دخولك" : "Session expired");
      } else {
        toast.error(ar ? "فشل الحذف" : "Delete failed");
      }
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-primary" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background p-4 sm:p-8" dir={ar ? "rtl" : "ltr"}>
      <Toaster position="top-center" />
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-2xl font-extrabold text-primary">
            <Trophy className="me-2 inline size-6" />
            {ar ? "نتائج الطلبة" : "Student results"}
          </h1>
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-xs font-semibold"
          >
            <Home className="size-4" /> {ar ? "الرئيسية" : "Home"}
          </Link>
        </div>

        {shares.length === 0 && (
          <Card className="rounded-3xl p-8 text-center text-muted-foreground">
            {ar
              ? "لا توجد دروس مشتركة بعد. شاركي درسًا مع طلبتك وستظهر نتائجهم هنا."
              : "No shared lessons yet. Share a lesson and results will appear here."}
          </Card>
        )}

        {shares.length > 0 && (
          <>
            <Card className="rounded-3xl p-4 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative flex-1">
                  <Search className="absolute top-1/2 size-4 -translate-y-1/2 text-muted-foreground ltr:left-3 rtl:right-3" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={ar ? "ابحث باسم الطالب…" : "Search by student name…"}
                    className="rounded-xl ltr:pl-9 rtl:pr-9"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleSort("date")}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-xs font-semibold"
                  >
                    {sortKey === "date" && sortDir === "desc" ? (
                      <ArrowDownAZ className="size-3.5" />
                    ) : (
                      <ArrowUpZA className="size-3.5" />
                    )}
                    {ar ? "التاريخ" : "Date"}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSort("score")}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-xs font-semibold"
                  >
                    {sortKey === "score" && sortDir === "desc" ? (
                      <ArrowDownAZ className="size-3.5" />
                    ) : (
                      <ArrowUpZA className="size-3.5" />
                    )}
                    {ar ? "الدرجة" : "Score"}
                  </button>
                  <button
                    type="button"
                    onClick={exportCsv}
                    className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
                  >
                    <Download className="size-3.5" /> {ar ? "تصدير CSV" : "Export CSV"}
                  </button>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-2xl bg-muted/50 p-3 text-center">
                  <p className="text-xs text-muted-foreground">{ar ? "الطلاب" : "Students"}</p>
                  <p className="font-display text-xl font-bold">{totalStudents}</p>
                </div>
                <div className="rounded-2xl bg-muted/50 p-3 text-center">
                  <p className="text-xs text-muted-foreground">{ar ? "المعدّل" : "Average"}</p>
                  <p className="font-display text-xl font-bold">{avgScore}%</p>
                </div>
                <div className="rounded-2xl bg-muted/50 p-3 text-center">
                  <p className="text-xs text-muted-foreground">{ar ? "الدروس" : "Lessons"}</p>
                  <p className="font-display text-xl font-bold">{shares.length}</p>
                </div>
                <div className="rounded-2xl bg-muted/50 p-3 text-center">
                  <p className="text-xs text-muted-foreground">{ar ? "محاولات" : "Attempts"}</p>
                  <p className="font-display text-xl font-bold">
                    {shares.reduce((sum, s) => sum + s.results.length, 0)}
                  </p>
                </div>
              </div>
            </Card>

            {missedQuestions.length > 0 && (
              <Card className="rounded-3xl p-5">
                <h2 className="mb-3 font-display text-lg font-extrabold text-destructive">
                  {ar ? "أكثر الأسئلة خطأً" : "Most missed questions"}
                </h2>
                <ul className="space-y-2">
                  {missedQuestions.map((q, i) => (
                    <li key={i} className="rounded-xl bg-muted/40 p-3 text-sm">
                      <span className="font-bold">{q.wrong}/{q.total}</span>{" "}
                      {ar ? "خطأ في:" : "wrong in:"}{" "}
                      <span className="text-muted-foreground">[{q.shareTitle}]</span> {q.prompt}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}

        {filteredShares.map((s) => (
          <Card key={s.token} className="rounded-3xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-lg font-extrabold">{s.title}</h2>
              <span className="text-xs text-muted-foreground">
                {new Date(s.createdAt).toLocaleDateString(ar ? "ar-EG" : "en-GB")} ·{" "}
                {ar ? `${s.results.length} طالب` : `${s.results.length} students`}
              </span>
            </div>

            {s.results.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                {ar ? "لم يحلّ أحد هذا الدرس بعد." : "Nobody has played this lesson yet."}
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-2xl border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/60 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-start font-semibold">#</th>
                      <th className="px-3 py-2 text-start font-semibold">
                        {ar ? "اسم الطالب" : "Student"}
                      </th>
                      <th className="px-3 py-2 text-start font-semibold">
                        {ar ? "الدرجة" : "Score"}
                      </th>
                      <th className="px-3 py-2 text-start font-semibold">
                        {ar ? "النسبة" : "%"}
                      </th>
                      <th className="px-3 py-2 text-start font-semibold">
                        {ar ? "التاريخ" : "Date"}
                      </th>
                      <th className="px-3 py-2 text-start font-semibold">
                        {ar ? "الإجابات" : "Answers"}
                      </th>
                      <th className="px-3 py-2 text-start font-semibold">
                        {ar ? "حذف" : "Delete"}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.results.map((r, idx) => (
                      <Fragment key={r.id}>
                        <tr className="border-t border-border">
                          <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                          <td className="px-3 py-2 font-semibold">{r.studentName}</td>
                          <td className="px-3 py-2 font-bold text-emerald">
                            {r.score} / {r.total}
                          </td>
                          <td className="px-3 py-2">
                            {r.total ? Math.round((r.score / r.total) * 100) : 0}%
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {new Date(r.createdAt).toLocaleString(ar ? "ar-EG" : "en-GB")}
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              className="rounded-full border border-border px-3 py-1 text-xs font-semibold"
                              onClick={() => setOpen(open === r.id ? null : r.id)}
                            >
                              {open === r.id
                                ? ar
                                  ? "إخفاء"
                                  : "Hide"
                                : ar
                                  ? "عرض"
                                  : "View"}
                            </button>
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              disabled={deleting === r.id}
                              onClick={() => handleDelete(r.id)}
                              className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-1 text-xs font-semibold text-destructive disabled:opacity-50"
                            >
                              {deleting === r.id ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <Trash2 className="size-3" />
                              )}
                              {ar ? "حذف" : "Delete"}
                            </button>
                          </td>
                        </tr>
                        {open === r.id && (
                          <tr className="border-t border-border bg-muted/30">
                            <td colSpan={7} className="px-3 py-3">
                              <ul className="space-y-2 text-sm">
                                {r.answers.map((a, i) => (
                                  <li key={`${r.id}-${i}`} className="flex items-start gap-2">
                                    {a.isCorrect ? (
                                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald" />
                                    ) : (
                                      <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                                    )}
                                    <div>
                                      <p className="font-medium">{a.prompt}</p>
                                      <p className="text-muted-foreground">
                                        {ar ? "إجابته:" : "Answer:"} {a.picked}
                                        {!a.isCorrect && (
                                          <>
                                            {" — "}
                                            {ar ? "الصحيح:" : "Correct:"} {a.correct}
                                          </>
                                        )}
                                      </p>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        ))}
      </div>
    </main>
  );
}
