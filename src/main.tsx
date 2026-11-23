import { createRoot } from "react-dom/client";
import { ThemeProvider } from "./components/theme-provider";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
    <App />
  </ThemeProvider>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((error: unknown) => {
        console.error("Service worker registration failed", error);
      });
  });
}
