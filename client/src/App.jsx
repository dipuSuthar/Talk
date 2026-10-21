import { useEffect, useState, useCallback } from "react";
import { useAuth } from "./store/auth.js";
import AuthPage from "./pages/AuthPage.jsx";
import ChatPage from "./pages/ChatPage.jsx";
import { Toasts, Spinner } from "./components/ui.jsx";

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem("talk-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0b0f17" : "#ffffff");
    localStorage.setItem("talk-theme", theme);
  }, [theme]);
  return [theme, useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), [])];
}

export default function App() {
  const status = useAuth((s) => s.status);
  const init = useAuth((s) => s.init);
  const signedOut = useAuth((s) => s.signedOut);
  const [theme, toggleTheme] = useTheme();

  useEffect(() => {
    init();
    window.addEventListener("talk:signed-out", signedOut);
    return () => window.removeEventListener("talk:signed-out", signedOut);
  }, [init, signedOut]);

  return (
    <>
      {status === "loading" && <div className="grid h-dvh place-items-center text-accent"><Spinner size={32} /></div>}
      {status === "out" && <AuthPage />}
      {status === "in" && <ChatPage theme={theme} toggleTheme={toggleTheme} />}
      <Toasts />
    </>
  );
}
