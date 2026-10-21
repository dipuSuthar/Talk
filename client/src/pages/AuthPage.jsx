import { useState } from "react";
import { MessageCircle, ShieldCheck, EyeOff, Zap } from "lucide-react";
import { useAuth } from "../store/auth.js";
import { errMsg } from "../lib/api.js";
import { Button } from "../components/ui.jsx";

const checks = (p) => [
  ["8+ characters", p.length >= 8],
  ["a letter", /[A-Za-z]/.test(p)],
  ["a number", /\d/.test(p)],
];

export default function AuthPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const signup = mode === "signup";

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (signup && checks(form.password).some(([, ok]) => !ok)) return setError("Choose a stronger password");
    setBusy(true);
    try {
      if (signup) await register(form.name.trim(), form.email.trim(), form.password);
      else await login(form.email.trim(), form.password);
    } catch (err) {
      setError(errMsg(err, "Couldn't sign you in"));
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30";

  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      <section className="relative hidden overflow-hidden bg-gradient-to-br from-indigo-600 via-violet-600 to-cyan-500 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3 text-2xl font-bold"><MessageCircle /> Talk</div>
        <div>
          <h1 className="text-4xl leading-tight font-extrabold">Chat that feels instant.<br />Privacy that’s built in.</h1>
          <ul className="mt-8 space-y-4 text-white/90">
            <li className="flex items-center gap-3"><Zap size={20} /> Real-time messages, typing and read receipts</li>
            <li className="flex items-center gap-3"><EyeOff size={20} /> Send photos &amp; videos that vanish after 1 or 2 views</li>
            <li className="flex items-center gap-3"><ShieldCheck size={20} /> Strict file checks, stripped location data, secure sessions</li>
          </ul>
        </div>
        <p className="text-sm text-white/70">Stickers, GIFs, group chats and more.</p>
      </section>

      <section className="grid place-items-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4" noValidate>
          <div className="mb-2 flex items-center gap-2 text-xl font-bold lg:hidden"><MessageCircle className="text-accent" /> Talk</div>
          <div>
            <h2 className="text-2xl font-bold">{signup ? "Create your account" : "Welcome back"}</h2>
            <p className="mt-1 text-sm text-muted">{signup ? "It takes less than a minute." : "Sign in to continue your conversations."}</p>
          </div>

          {signup && <input className={field} placeholder="Full name" autoComplete="name" value={form.name} onChange={set("name")} required minLength={2} maxLength={60} aria-label="Full name" />}
          <input className={field} type="email" placeholder="Email" autoComplete="email" value={form.email} onChange={set("email")} required aria-label="Email" />
          <input className={field} type="password" placeholder="Password" autoComplete={signup ? "new-password" : "current-password"} value={form.password} onChange={set("password")} required aria-label="Password" />

          {signup && form.password && (
            <ul className="flex flex-wrap gap-2 text-xs">
              {checks(form.password).map(([label, ok]) => (
                <li key={label} className={`rounded-full px-2.5 py-1 ${ok ? "bg-emerald-500/15 text-emerald-600" : "bg-surface-2 text-muted"}`}>{ok ? "✓" : "•"} {label}</li>
              ))}
            </ul>
          )}

          {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

          <Button type="submit" loading={busy} className="w-full">{signup ? "Sign up" : "Sign in"}</Button>

          <p className="text-center text-sm text-muted">
            {signup ? "Already have an account?" : "New here?"}{" "}
            <button type="button" className="font-semibold text-accent hover:underline" onClick={() => { setMode(signup ? "login" : "signup"); setError(""); }}>
              {signup ? "Sign in" : "Create an account"}
            </button>
          </p>
        </form>
      </section>
    </main>
  );
}
