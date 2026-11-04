import { Bell, MessageSquare, Mail, Smartphone, Inbox, CheckCheck } from "lucide-react";
import { useState } from "react";
import { Drawer } from "../ui";
import { useApp } from "../store";
import { fmtTime, post, type Note } from "../api";
const CH: Record<string, typeof Bell> = { sms: MessageSquare, email: Mail, push: Smartphone, in_app: Inbox };
const KINDS = ["all", "gate", "dock", "task", "detention", "system"] as const;
/** Notification centre: everything the platform queued for drivers, carriers and staff (the outbox). Nothing here is sent externally in this build. */
export function Notifications({ notes, onClose }: { notes: Note[]; onClose: () => void }) {
  const { run } = useApp(); const [k, setK] = useState<(typeof KINDS)[number]>("all");
  const list = notes.filter((n) => k === "all" || n.kind === k); const unread = notes.filter((n) => !n.read).length;
  return <Drawer title={<><Bell size={15} />Notifications<span className="mu" style={{ fontWeight: 400 }}>{unread} unread</span></>} onClose={onClose}>
    <div className="row notes-bar">{KINDS.map((x) => <button key={x} className={"chip" + (k === x ? " on" : "")} onClick={() => setK(x)}>{x}</button>)}<span className="sp" />
      <button className="btn sm ghost" disabled={!unread} onClick={() => run(() => post("/notifications/read-all"), "All marked read")}><CheckCheck size={14} />Mark all read</button></div>
    <div className="notes">{list.map((n) => { const I = CH[n.channel] ?? Inbox; return (
      <button key={n.id} className={"note" + (n.read ? "" : " unread")} onClick={() => !n.read && run(() => post(`/notifications/${n.id}/read`), "Marked read")}>
        <I size={15} /><span><b>{n.text}</b><small className="mu">{n.channel.replace("_", "-")} → {n.to} · {fmtTime(n.at)}</small></span>{!n.read && <i className="dot" />}</button>); })}
      {!list.length && <div className="empty-note">No notifications yet. Gate check-ins, door calls, completed moves and charge decisions appear here.</div>}</div>
    <p className="hint" style={{ padding: "8px 12px" }}>SMS, e-mail and push are queued in the outbox; channel adapters are not connected in this build, so nothing leaves the platform.</p>
  </Drawer>;
}
