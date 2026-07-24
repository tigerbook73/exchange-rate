"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

const THEME_OPTIONS = [
  { value: "light", label: "亮色", icon: Sun },
  { value: "dark", label: "暗色", icon: Moon },
  { value: "system", label: "跟随系统", icon: Monitor },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // Theme is only known after mount (avoids hydration mismatch with SSR);
  // this is next-themes' documented pattern, not a derivable-state anti-pattern.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time client-mount flag, cannot be derived from props/state
    setMounted(true);
  }, []);

  return (
    <div className="flex items-center gap-1" role="group" aria-label="主题切换">
      {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
        <Button
          key={value}
          type="button"
          size="sm"
          variant={mounted && theme === value ? "default" : "outline"}
          aria-pressed={mounted && theme === value}
          onClick={() => setTheme(value)}
        >
          <Icon className="size-4" />
          {label}
        </Button>
      ))}
    </div>
  );
}
