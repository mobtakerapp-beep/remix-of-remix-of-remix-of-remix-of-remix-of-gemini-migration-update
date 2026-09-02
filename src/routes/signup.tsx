import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "إنشاء حساب — مولّد الدروس الذكي" },
      {
        name: "description",
        content: "أنشئ حسابًا مجانيًا لتوليد الدروس والألعاب وأوراق العمل ومشاركتها مع طلابك.",
      },
      { property: "og:title", content: "إنشاء حساب — مولّد الدروس الذكي" },
      {
        property: "og:description",
        content: "ابدأ مجانًا في توليد دروس تفاعلية وأوراق عمل جاهزة للطباعة.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/auth" });
  },
});
