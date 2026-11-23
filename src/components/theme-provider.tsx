import { ThemeProvider as SystemThemeProvider } from "next-themes";
import type { ComponentProps } from "react";

export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof SystemThemeProvider>) {
  return <SystemThemeProvider {...props}>{children}</SystemThemeProvider>;
}
