import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { api, errMsg } from "../lib/api.js";
import { Avatar, Spinner } from "./ui.jsx";
import { useChat } from "../store/chat.js";

/** Debounced people search. People are found by name or by their exact email address. */
export default function UserPicker({ onPick, exclude = [], selected = [], placeholder = "Search by name, or exact email" }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const online = useChat((s) => s.online);

  const term = q.trim();
  const searchable = term.length >= 2;

  useEffect(() => {
    if (!searchable) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await api.get("/users/search", { params: { q: term }, signal: ctl.signal });
        setResults(data);
        setError("");
      } catch (e) {
        if (e.code !== "ERR_CANCELED") setError(errMsg(e));
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [term, searchable]);

  const visible = searchable ? results.filter((u) => !exclude.includes(u._id)) : [];
  return (
    <div>
      <div className="relative">
        <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Search people" className="w-full rounded-xl border border-line bg-surface-2 py-2.5 pr-9 pl-9 text-sm outline-none focus:border-accent" />
        {searchable && loading && <Spinner size={16} className="absolute top-1/2 right-3 -translate-y-1/2 text-muted" />}
      </div>
      {searchable && error && <p className="mt-2 text-sm text-danger">{error}</p>}
      <ul className="mt-2 space-y-1">
        {visible.map((u) => (
          <li key={u._id}>
            <button onClick={() => onPick(u)} className={`flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-surface-2 ${selected.includes(u._id) ? "bg-accent/10" : ""}`}>
              <Avatar user={u} online={online[u._id]} />
              <span className="min-w-0"><span className="block truncate font-medium">{u.name}</span><span className="block truncate text-xs text-muted">{u.email}</span></span>
              {selected.includes(u._id) && <span className="ml-auto text-xs font-semibold text-accent">Added</span>}
            </button>
          </li>
        ))}
        {searchable && !loading && !visible.length && !error && <li className="px-2 py-4 text-center text-sm text-muted">No one found. Try their full email address.</li>}
      </ul>
    </div>
  );
}
