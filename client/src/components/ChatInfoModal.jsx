import { useState } from "react";
import { Crown, LogOut, Ban, Pencil, UserPlus, UserMinus } from "lucide-react";
import { api, errMsg } from "../lib/api.js";
import { useAuth } from "../store/auth.js";
import { useChat } from "../store/chat.js";
import { toast } from "../store/toast.js";
import { isAdmin, otherMember } from "../lib/chat.js";
import { Avatar, Button, IconButton, Modal } from "./ui.jsx";
import UserPicker from "./UserPicker.jsx";

export default function ChatInfoModal({ chat, onClose }) {
  const me = useAuth((s) => s.user);
  const { blocked, block, unblock } = useAuth();
  const upsertChat = useChat((s) => s.upsertChat);
  const setActive = useChat((s) => s.setActive);
  const online = useChat((s) => s.online);
  const admin = isAdmin(chat, me._id);
  const [name, setName] = useState(chat.name ?? "");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (fn, ok) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (chat.type === "direct") {
    const other = otherMember(chat, me._id);
    const isBlocked = blocked[other._id];
    return (
      <Modal title="Contact info" onClose={onClose}>
        <div className="flex flex-col items-center gap-2 p-6 text-center">
          <Avatar user={other} size={88} online={online[other._id]} />
          <h3 className="text-xl font-semibold">{other.name}</h3>
          {other.about && <p className="text-sm text-muted">{other.about}</p>}
          <Button variant={isBlocked ? "ghost" : "danger"} className="mt-4" loading={busy} onClick={() => run(() => (isBlocked ? unblock(other._id) : block(other._id)), isBlocked ? "Unblocked" : "Blocked")}>
            <Ban size={16} /> {isBlocked ? "Unblock" : "Block"} {other.name.split(" ")[0]}
          </Button>
          <p className="max-w-xs text-xs text-muted">Blocked people can’t send you messages and you can’t send them any.</p>
        </div>
      </Modal>
    );
  }

  const memberIds = chat.members.map((m) => m.user._id);
  const rename = () => run(async () => upsertChat((await api.patch(`/chats/${chat._id}`, { name: name.trim() })).data), "Group renamed");
  const addMember = (u) => run(async () => { upsertChat((await api.post(`/chats/${chat._id}/members`, { userIds: [u._id] })).data); setAdding(false); });
  const remove = (id) => run(() => api.delete(`/chats/${chat._id}/members/${id}`));
  const leave = () => run(async () => { await api.delete(`/chats/${chat._id}/members/${me._id}`); setActive(null); onClose(); });

  return (
    <Modal title="Group info" onClose={onClose} wide>
      <div className="space-y-5 p-5">
        {admin ? (
          <div className="flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Group name" className="min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-sm outline-none focus:border-accent" />
            <Button variant="ghost" loading={busy} disabled={!name.trim() || name.trim() === chat.name} onClick={rename}><Pencil size={14} /> Rename</Button>
          </div>
        ) : <h3 className="text-xl font-semibold">{chat.name}</h3>}

        <div>
          <div className="mb-2 flex items-center justify-between"><h4 className="text-sm font-semibold text-muted">{chat.members.length} members</h4>
            {admin && <button onClick={() => setAdding((v) => !v)} className="flex items-center gap-1 text-sm font-semibold text-accent"><UserPlus size={14} /> Add people</button>}</div>
          {adding && <div className="mb-3 rounded-2xl border border-line p-3"><UserPicker exclude={memberIds} onPick={addMember} /></div>}
          <ul className="space-y-1">
            {chat.members.map(({ user: u, role }) => (
              <li key={u._id} className="flex items-center gap-3 rounded-xl p-2">
                <Avatar user={u} online={online[u._id]} />
                <span className="min-w-0 flex-1 truncate font-medium">{u.name}{u._id === me._id && <span className="text-muted"> (you)</span>}</span>
                {role === "admin" && <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-600"><Crown size={12} />Admin</span>}
                {admin && u._id !== me._id && <IconButton label={`Remove ${u.name}`} className="!size-8 hover:!text-danger" onClick={() => remove(u._id)}><UserMinus size={16} /></IconButton>}
              </li>
            ))}
          </ul>
        </div>
        <Button variant="danger" className="w-full" loading={busy} onClick={() => window.confirm("Leave this group?") && leave()}><LogOut size={16} /> Leave group</Button>
      </div>
    </Modal>
  );
}
