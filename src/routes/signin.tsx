import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/signin")({
  head: () => ({
    meta: [
      { title: "تسجيل الدخول — مولّد الدروس الذكي" },
      {
        name: "description",
        content: "سجّل الدخول لحفظ دروسك ومشاركتها مع طلابك ومتابعة نتائجهم.",
      },
      { property: "og:title", content: "تسجيل الدخول — مولّد الدروس الذكي" },
      {
        property: "og:description",
        content: "ادخل إلى حسابك لإدارة الدروس ونتائج الطلبة.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/auth" });
  },
});
