"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Archive, ArrowLeft, Hash, Loader2, Lock, LogOut, MessagesSquare, Plus, Search, UserPlus, Users, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/components/layout/UserContext";
import { Modal } from "@/components/ui/Modal";
import ChatConversation from "@/components/chat/ChatConversation";
import { getInitials } from "@/lib/format";
import type { ChatChannel, ChatPerson } from "@/lib/chat";

type Unread = Record<string, { unread: number; mentions: number }>;

const inputClass = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-navy focus:ring-2 focus:ring-navy/15";

export default function ChatPage() {
  const user = useCurrentUser();
  const me = user?.id || "";
  const isAdmin = !!user?.isAdmin;
  const [supabase] = useState(() => createClient());

  const [people, setPeople] = useState<ChatPerson[]>([]);
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [memberships, setMemberships] = useState<{ channel_id: string; user_id: string; role: string }[]>([]);
  const [taskTitles, setTaskTitles] = useState<Record<string, string>>({});
  const [unread, setUnread] = useState<Unread>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<null | "channel" | "dm" | "browse" | "members">(null);
  const [error, setError] = useState("");

  const nameOf = useCallback((id?: string | null) => people.find((p) => p.id === id)?.name || "Former member", [people]);

  const load = useCallback(async () => {
    const [{ data: ppl }, { data: chs }, { data: mem }, { data: un }] = await Promise.all([
      supabase.from("profiles").select("id, name, is_active, role").order("name"),
      supabase.from("chat_channels").select("*").order("last_message_at", { ascending: false }),
      supabase.from("chat_members").select("channel_id, user_id, role"),
      supabase.rpc("chat_unread"),
    ]);
    setPeople((ppl || []) as ChatPerson[]);
    setChannels((chs || []) as ChatChannel[]);
    setMemberships(mem || []);
    setUnread(Object.fromEntries(((un || []) as any[]).map((u) => [u.channel_id, { unread: u.unread, mentions: u.mentions }])));
    const taskIds = (chs || []).filter((c: any) => c.kind === "task").map((c: any) => c.task_id);
    if (taskIds.length) {
      const { data: tasks } = await supabase.from("tasks").select("id, title, period").in("id", taskIds);
      setTaskTitles(Object.fromEntries((tasks || []).map((t: any) => [t.id, `${t.title}${t.period ? ` · ${t.period}` : ""}`])));
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
    const c = new URLSearchParams(window.location.search).get("c");
    if (c) setSelected(c);

    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(load, 400);
    };
    const channel = supabase
      .channel("chat-sidebar")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_members" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_channels" }, refresh)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      window.clearTimeout(timer);
    };
  }, []);

  // Default to #general
  useEffect(() => {
    if (!selected && channels.length) {
      const general = channels.find((c) => c.kind === "channel" && c.name === "general");
      if (general && window.innerWidth >= 1024) setSelected(general.id);
    }
  }, [channels, selected]);

  const myChannelIds = useMemo(() => new Set(memberships.filter((m) => m.user_id === me).map((m) => m.channel_id)), [memberships, me]);

  const labelOf = useCallback(
    (c: ChatChannel) => {
      if (c.kind === "channel") return c.name || "channel";
      if (c.kind === "task") return taskTitles[c.task_id || ""] || "Task discussion";
      const other = memberships.find((m) => m.channel_id === c.id && m.user_id !== me);
      return nameOf(other?.user_id);
    },
    [memberships, me, nameOf, taskTitles]
  );

  const active = channels.filter((c) => !c.archived_at);
  const q = search.trim().toLowerCase();
  const matches = (c: ChatChannel) => !q || labelOf(c).toLowerCase().includes(q);
  const myChannels = active.filter((c) => c.kind === "channel" && myChannelIds.has(c.id) && matches(c)).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const dms = active.filter((c) => c.kind === "dm" && matches(c));
  const threads = active.filter((c) => c.kind === "task" && myChannelIds.has(c.id) && matches(c)).slice(0, 30);
  const browsable = active.filter((c) => c.kind === "channel" && !c.is_private && !myChannelIds.has(c.id));

  const current = channels.find((c) => c.id === selected) || null;
  const currentMembers = memberships.filter((m) => m.channel_id === selected);
  const amOwner = currentMembers.some((m) => m.user_id === me && m.role === "owner");

  function open(id: string) {
    setSelected(id);
    window.history.replaceState(null, "", `/chat?c=${id}`);
  }

  async function rpc(name: string, args: Record<string, unknown>) {
    setError("");
    const { data, error: err } = await supabase.rpc(name, args);
    if (err) {
      setError(err.message);
      return null;
    }
    await load();
    return data;
  }

  function Item({ c }: { c: ChatChannel }) {
    const u = unread[c.id];
    const isSel = c.id === selected;
    const Icon = c.kind === "channel" ? (c.is_private ? Lock : Hash) : c.kind === "task" ? MessagesSquare : null;
    return (
      <button
        type="button"
        onClick={() => open(c.id)}
        className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition ${
          isSel ? "bg-navy text-white" : u?.unread ? "font-bold text-text-main hover:bg-surface-alt" : "text-text-muted hover:bg-surface-alt"
        }`}
      >
        {Icon ? (
          <Icon className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold ${isSel ? "bg-white/20" : "bg-navy/10 text-navy"}`}>
            {getInitials(labelOf(c))}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{labelOf(c)}</span>
        {u?.mentions ? <span className="rounded-full bg-rose-600 px-1.5 text-[10px] font-bold text-white">@{u.mentions}</span> : null}
        {u?.unread && !isSel ? <span className={`rounded-full px-1.5 text-[10px] font-bold ${isSel ? "bg-white/20" : "bg-navy text-white"}`}>{u.unread}</span> : null}
      </button>
    );
  }

  const conversationPeople = people;

  return (
    <div className="flex h-[calc(100vh-8.5rem)] min-h-[480px] overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      {/* Sidebar */}
      <aside className={`w-full shrink-0 flex-col border-r border-border bg-surface-alt/40 lg:flex lg:w-72 ${selected ? "hidden" : "flex"}`}>
        <div className="space-y-2 border-b border-border p-3">
          <div className="flex items-center justify-between">
            <h1 className="flex items-center gap-2 text-base font-bold text-text-main">
              <MessagesSquare className="h-4 w-4 text-navy" /> Team Chat
            </h1>
            <button type="button" onClick={() => setModal("dm")} className="rounded-md p-1.5 text-navy hover:bg-surface" title="New message">
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a conversation" className="w-full rounded-lg border border-border bg-surface py-1.5 pl-8 pr-2 text-xs outline-none focus:border-navy" />
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-6 text-xs text-text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <>
              <section>
                <div className="flex items-center justify-between px-2 pb-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Channels</p>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => setModal("browse")} className="text-[10px] font-semibold text-navy hover:underline">
                      Browse
                    </button>
                    <button type="button" onClick={() => setModal("channel")} className="rounded p-0.5 text-navy hover:bg-surface" title="New channel">
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {myChannels.map((c) => (
                  <Item key={c.id} c={c} />
                ))}
              </section>
              <section>
                <div className="flex items-center justify-between px-2 pb-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Direct messages</p>
                  <button type="button" onClick={() => setModal("dm")} className="rounded p-0.5 text-navy hover:bg-surface" title="New message">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
                {dms.length ? dms.map((c) => <Item key={c.id} c={c} />) : <p className="px-2.5 text-[11px] text-text-muted">No direct messages yet.</p>}
              </section>
              {threads.length > 0 && (
                <section>
                  <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">Task discussions</p>
                  {threads.map((c) => (
                    <Item key={c.id} c={c} />
                  ))}
                </section>
              )}
            </>
          )}
        </div>
      </aside>

      {/* Conversation */}
      <section className={`min-w-0 flex-1 flex-col ${selected ? "flex" : "hidden lg:flex"}`}>
        {current ? (
          <>
            <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <button type="button" onClick={() => setSelected(null)} className="rounded-md p-1 text-text-muted hover:bg-surface-alt lg:hidden" aria-label="Back to conversations">
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate text-sm font-bold text-text-main">
                    {current.kind === "channel" && (current.is_private ? <Lock className="h-3.5 w-3.5" /> : <Hash className="h-3.5 w-3.5" />)}
                    {labelOf(current)}
                  </p>
                  <p className="truncate text-[11px] text-text-muted">
                    {current.kind === "channel"
                      ? `${current.description ? `${current.description} · ` : ""}${currentMembers.length} member${currentMembers.length === 1 ? "" : "s"}`
                      : current.kind === "dm"
                      ? "Direct message"
                      : "Task discussion"}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {current.kind === "task" && current.task_id && (
                  <Link href={`/tasks?task=${current.task_id}`} className="rounded-md border border-border px-2.5 py-1 text-[11px] font-semibold text-navy hover:bg-surface-alt">
                    Open task
                  </Link>
                )}
                {current.kind === "channel" && (
                  <>
                    {myChannelIds.has(current.id) ? (
                      <>
                        <button type="button" onClick={() => setModal("members")} className="rounded-md p-1.5 text-text-muted hover:bg-surface-alt" title="Members">
                          <Users className="h-4 w-4" />
                        </button>
                        {current.name !== "general" && (
                          <button
                            type="button"
                            onClick={async () => {
                              if (window.confirm(`Leave #${current.name}?`)) {
                                await rpc("chat_leave", { p_channel: current.id });
                                setSelected(null);
                              }
                            }}
                            className="rounded-md p-1.5 text-text-muted hover:bg-surface-alt"
                            title="Leave channel"
                          >
                            <LogOut className="h-4 w-4" />
                          </button>
                        )}
                        {(amOwner || isAdmin) && current.name !== "general" && (
                          <button
                            type="button"
                            onClick={async () => {
                              if (window.confirm(`Archive #${current.name}? Nobody will be able to post in it.`)) {
                                await rpc("chat_archive", { p_channel: current.id });
                                setSelected(null);
                              }
                            }}
                            className="rounded-md p-1.5 text-text-muted hover:bg-surface-alt"
                            title="Archive channel"
                          >
                            <Archive className="h-4 w-4" />
                          </button>
                        )}
                      </>
                    ) : (
                      <button type="button" onClick={() => rpc("chat_join", { p_channel: current.id })} className="rounded-md bg-navy px-3 py-1 text-[11px] font-semibold text-white">
                        Join channel
                      </button>
                    )}
                  </>
                )}
              </div>
            </header>
            {error && <p className="border-b border-border bg-rose-50 px-3 py-1.5 text-[11px] text-rose-700">{error}</p>}
            <div className="min-h-0 flex-1">
              <ChatConversation
                key={current.id}
                channelId={current.id}
                people={conversationPeople}
                placeholder={current.kind === "channel" ? `Message #${current.name} (@ to mention)` : `Message ${labelOf(current)}`}
                onRead={(id) => setUnread((u) => ({ ...u, [id]: { unread: 0, mentions: 0 } }))}
              />
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-xs text-text-muted">Choose a conversation.</div>
        )}
      </section>

      {modal === "channel" && <NewChannelModal people={people.filter((p) => p.id !== me && p.is_active !== false)} onClose={() => setModal(null)} onCreated={async (id) => { setModal(null); await load(); open(id); }} />}

      {modal === "dm" && (
        <Modal title="New message" subtitle="Start a direct conversation with a colleague." onClose={() => setModal(null)} maxWidth="max-w-md">
          <PeoplePicker
            people={people.filter((p) => p.id !== me && p.is_active !== false)}
            onPick={async (p) => {
              const id = await rpc("chat_open_dm", { p_other: p.id });
              setModal(null);
              if (id) open(id as string);
            }}
          />
        </Modal>
      )}

      {modal === "browse" && (
        <Modal title="Browse channels" subtitle="Public channels you haven't joined." onClose={() => setModal(null)} maxWidth="max-w-md">
          {browsable.length === 0 ? (
            <p className="text-xs text-text-muted">You're in every public channel.</p>
          ) : (
            <ul className="divide-y divide-border">
              {browsable.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="flex items-center gap-1 font-semibold">
                      <Hash className="h-3.5 w-3.5" /> {c.name}
                    </span>
                    {c.description && <span className="block truncate text-[11px] text-text-muted">{c.description}</span>}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      await rpc("chat_join", { p_channel: c.id });
                      setModal(null);
                      open(c.id);
                    }}
                    className="shrink-0 rounded-md bg-navy px-3 py-1 text-xs font-semibold text-white"
                  >
                    Join
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      {modal === "members" && current && (
        <Modal title={`Members of #${current.name}`} onClose={() => setModal(null)} maxWidth="max-w-md">
          <ul className="mb-4 max-h-60 space-y-1 overflow-y-auto">
            {currentMembers.map((m) => (
              <li key={m.user_id} className="flex items-center justify-between text-sm">
                <span>{nameOf(m.user_id)}</span>
                {m.role === "owner" && <span className="text-[10px] font-semibold uppercase text-text-muted">Owner</span>}
              </li>
            ))}
          </ul>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-text-main">
            <UserPlus className="h-3.5 w-3.5" /> Add people
          </p>
          <PeoplePicker
            people={people.filter((p) => p.is_active !== false && !currentMembers.some((m) => m.user_id === p.id))}
            onPick={async (p) => {
              await rpc("chat_add_members", { p_channel: current.id, p_users: [p.id] });
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function PeoplePicker({ people, onPick }: { people: ChatPerson[]; onPick: (p: ChatPerson) => void }) {
  const [q, setQ] = useState("");
  const list = people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-2">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name" className={inputClass} />
      <ul className="max-h-64 overflow-y-auto">
        {list.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => onPick(p)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-surface-alt">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-navy/10 text-[10px] font-bold text-navy">{getInitials(p.name)}</span>
              {p.name}
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="px-2 py-2 text-xs text-text-muted">No one found.</li>}
      </ul>
    </div>
  );
}

function NewChannelModal({ people, onClose, onCreated }: { people: ChatPerson[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [supabase] = useState(() => createClient());
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    setBusy(true);
    setError("");
    const { data, error: err } = await supabase.rpc("chat_create_channel", { p_name: name, p_description: description, p_private: isPrivate, p_members: members });
    setBusy(false);
    if (err) return setError(err.message);
    onCreated(data as string);
  }

  return (
    <Modal
      title="New channel"
      subtitle="Channels are for topics, teams or clients."
      onClose={onClose}
      maxWidth="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold">
            Cancel
          </button>
          <button type="button" onClick={create} disabled={busy || name.trim().length < 2} className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Create channel
          </button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        {error && <p className="text-xs text-rose-600">{error}</p>}
        <label className="block text-xs font-semibold">
          Name
          <div className="mt-1 flex items-center rounded-lg border border-border px-2 focus-within:border-navy">
            <Hash className="h-3.5 w-3.5 text-text-muted" />
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="gst-team" className="w-full bg-transparent px-1.5 py-2 text-sm outline-none" />
          </div>
        </label>
        <label className="block text-xs font-semibold">
          Description (optional)
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} className={`${inputClass} mt-1`} />
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} className="h-4 w-4 accent-navy" />
          <Lock className="h-3.5 w-3.5" /> Private: only people you add can see it
        </label>
        <div>
          <p className="mb-1 text-xs font-semibold">Add people {isPrivate ? "" : "(optional; anyone can join a public channel)"}</p>
          <div className="max-h-44 overflow-y-auto rounded-lg border border-border p-1">
            {people.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-surface-alt">
                <input
                  type="checkbox"
                  checked={members.includes(p.id)}
                  onChange={(e) => setMembers((m) => (e.target.checked ? [...m, p.id] : m.filter((x) => x !== p.id)))}
                  className="accent-navy"
                />
                {p.name}
              </label>
            ))}
          </div>
          {members.length > 0 && (
            <button type="button" onClick={() => setMembers([])} className="mt-1 inline-flex items-center gap-1 text-[11px] text-text-muted">
              <X className="h-3 w-3" /> Clear selection
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}