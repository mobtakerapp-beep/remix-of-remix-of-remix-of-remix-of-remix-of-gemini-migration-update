import { Image, ImageOff } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { getHideMascots, setHideMascots, subscribeHideMascots } from "@/lib/display-prefs";
import { useI18n } from "@/lib/i18n";

/** Global toggle to hide the cartoon images (home, worksheet/print, games, shared games). */
export function HideMascotsToggle() {
  const { lang } = useI18n();
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setHidden(getHideMascots());
    return subscribeHideMascots(() => setHidden(getHideMascots()));
  }, []);

  const label = hidden
    ? lang === "ar"
      ? "إظهار الصور"
      : "Show images"
    : lang === "ar"
      ? "إخفاء الصور"
      : "Hide images";

  return (
    <Button
      variant="secondary"
      size="sm"
      className="rounded-full"
      aria-pressed={hidden}
      title={label}
      onClick={() => setHideMascots(!hidden)}
    >
      {hidden ? <ImageOff className="mr-2 size-4" /> : <Image className="mr-2 size-4" />}
      {label}
    </Button>
  );
}

/** Hook for components that only need to read the preference. */
export function useHideMascots() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setHidden(getHideMascots());
    return subscribeHideMascots(() => setHidden(getHideMascots()));
  }, []);
  return hidden;
}
