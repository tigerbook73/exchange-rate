"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInstallPrompt } from "@/lib/use-install-prompt";

/** Renders nothing unless the browser actually offered an install prompt
 * (Chromium/Android). iOS Safari has no such API — those users add the app
 * via the Share sheet instead, which can't be triggered from a button. */
export function InstallButton() {
  const { canInstall, promptInstall } = useInstallPrompt();

  if (!canInstall) return null;

  return (
    <Button type="button" variant="outline" size="sm" onClick={promptInstall}>
      <Download className="size-4" />
      安装到主屏幕
    </Button>
  );
}
