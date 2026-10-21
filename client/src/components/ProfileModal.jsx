import { useRef, useState } from "react";
import { Camera, LogOut } from "lucide-react";
import { api, errMsg } from "../lib/api.js";
import { useAuth } from "../store/auth.js";
import { toast } from "../store/toast.js";
import { Avatar, Button, Modal } from "./ui.jsx";

export default function ProfileModal({ onClose }) {
  const { user, setUser, logout } = useAuth();
  const [name, setName] = useState(user.name);
  const [about, setAbout] = useState(user.about ?? "");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  async function save() {
    setBusy(true);
    try {
      const { data } = await api.patch("/users/me", { name: name.trim(), about: about.trim() });
      setUser(data.user);
      toast.success("Profile updated");
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function avatar(file) {
    if (!file) return;
    const form = new FormData();
    form.append("avatar", file);
    setBusy(true);
    try {
      const { data } = await api.put("/users/me/avatar", form);
      setUser(data.user);
      toast.success("Photo updated");
    } catch (e) {
      toast.error(errMsg(e, "Couldn't upload photo"));
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-sm outline-none focus:border-accent";
  return (
    <Modal title="Your profile" onClose={onClose}>
      <div className="space-y-4 p-5">
        <div className="flex justify-center">
          <button className="group relative" onClick={() => fileRef.current?.click()} aria-label="Change profile photo">
            <Avatar user={user} size={96} />
            <span className="absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white opacity-0 transition group-hover:opacity-100"><Camera /></span>
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { avatar(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        <label className="block text-sm font-medium">Name<input className={`${input} mt-1`} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></label>
        <label className="block text-sm font-medium">About<input className={`${input} mt-1`} value={about} onChange={(e) => setAbout(e.target.value)} maxLength={160} placeholder="Hey there! I'm using Talk" /></label>
        <Button className="w-full" loading={busy} disabled={name.trim().length < 2} onClick={save}>Save changes</Button>
        <Button variant="ghost" className="w-full" onClick={logout}><LogOut size={16} /> Sign out</Button>
      </div>
    </Modal>
  );
}
