import { useState } from "react";
import { X } from "lucide-react";
import { Modal, Button } from "./ui.jsx";
import UserPicker from "./UserPicker.jsx";
import { useChat } from "../store/chat.js";
import { errMsg } from "../lib/api.js";
import { toast } from "../store/toast.js";

export default function NewChatModal({ onClose }) {
  const { openDirect, createGroup } = useChat.getState();
  const [tab, setTab] = useState("direct");
  const [name, setName] = useState("");
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);

  async function direct(u) {
    setBusy(true);
    try {
      await openDirect(u._id);
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  const toggle = (u) => setPicked((p) => (p.some((x) => x._id === u._id) ? p.filter((x) => x._id !== u._id) : [...p, u]));

  async function group() {
    setBusy(true);
    try {
      await createGroup(name.trim(), picked.map((u) => u._id));
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New chat" onClose={onClose}>
      <div className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1 text-sm font-semibold">
          {["direct", "group"].map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-lg py-2 capitalize ${tab === t ? "bg-surface shadow" : "text-muted"}`}>{t === "direct" ? "One-to-one" : "New group"}</button>
          ))}
        </div>
        {tab === "group" && (
          <>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Group name" aria-label="Group name" className="w-full rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-sm outline-none focus:border-accent" />
            {picked.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {picked.map((u) => (
                  <span key={u._id} className="flex items-center gap-1 rounded-full bg-accent/15 py-1 pr-1.5 pl-3 text-xs font-semibold text-accent">{u.name}<button aria-label={`Remove ${u.name}`} onClick={() => toggle(u)}><X size={14} /></button></span>
                ))}
              </div>
            )}
          </>
        )}
        <UserPicker onPick={tab === "direct" ? direct : toggle} selected={picked.map((u) => u._id)} />
        {tab === "group" && <Button className="w-full" loading={busy} disabled={!name.trim() || picked.length < 2} onClick={group}>Create group{picked.length < 2 ? " (pick at least 2 people)" : ""}</Button>}
      </div>
    </Modal>
  );
}
