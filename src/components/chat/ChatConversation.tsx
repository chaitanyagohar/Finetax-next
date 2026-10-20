"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MessagesSquare } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/components/layout/UserContext";
import { dayLabel, type ChatAttachment, type ChatMessage, type ChatPerson } from "@/lib/chat";
import ChatMessageView from "./ChatMessageView";
import ChatComposer from "./ChatComposer";

const PAGE = 50;

/** One conversation: a channel/DM (channelId) or a task thread (taskId, created on first message). */
export default function ChatConversation({
  channelId,
  taskId,
  people,
  placeholder = "Write a message… (@ to mention)",
  onRead,
}: {
  channelId?: string | null;
  taskId?: string;
  people: ChatPerson[];
  placeholder?: string;
  onRead?: (channelId: string) => void;
}) {
  const user = useCurrentUser();
  const me = user?.id || "";
  const isAdmin = !!user?.isAdmin;
  const [supabase] = useState(() => createClient());
  const [cid, setCid] = useState<string | null>(channelId || null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const names = Object.fromEntries(people.map((p) => [p.id, p.name]));

  // Task threads: find an existing thread (it's created on the first message)
  useEffect(() => {
    if (channelId) {
      setCid(channelId);
      return;
    }
    if (!taskId) return;
    setLoading(true);
    supabase
      .from("chat_channels")
      .select("id")
      .eq("task_id", taskId)
      .maybeSingle()
      .then(({ data }) => {
        setCid(data?.id || null);
        if (!data) setLoading(false);
      });
  }, [channelId, taskId]);

  const markRead = useCallback(
    (id: string) => {
      supabase.rpc("chat_mark_read", { p_channel: id }).then(() => onRead?.(id));
    },
    [supabase, onRead]
  );

  // Load + live updates
  useEffect(() => {
    if (!cid) {
      setMessages([]);
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    stickToBottom.current = true;
    supabase
      .from("chat_messages")
      .select("*")
      .eq("channel_id", cid)
      .order("created_at", { ascending: false })
      .limit(PAGE)
      .then(({ data, error: err }) => {
        if (!active) return;
        if (err) setError("Could not load messages.");
        setMessages(((data || []) as ChatMessage[]).reverse());
        setHasMore((data || []).length === PAGE);
        setLoading(false);
        markRead(cid);
      });

    const channel = supabase
      .channel(`chat-${cid}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages", filter: `channel_id=eq.${cid}` }, (payload: any) => {
        const row = payload.new as ChatMessage;
        if (!row?.id) return;
        setMessages((list) => {
          const i = list.findIndex((x) => x.id === row.id);
          if (i >= 0) {
            const copy = list.slice();
            copy[i] = row;
            return copy;
          }
          return [...list, row];
        });
        if (payload.eventType === "INSERT" && document.visibilityState === "visible") markRead(cid);
      })
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [cid]);

  // Keep the newest message in view unless the person scrolled up
  useEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function loadOlder() {
    if (!cid || !messages.length) return;
    setLoadingOlder(true);
    const el = scroller.current;
    const prevHeight = el?.scrollHeight || 0;
    const { data } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("channel_id", cid)
      .lt("created_at", messages[0].created_at)
      .order("created_at", { ascending: false })
      .limit(PAGE);
    const older = ((data || []) as ChatMessage[]).reverse();
    stickToBottom.current = false;
    setMessages((list) => [...older, ...list]);
    setHasMore(older.length === PAGE);
    setLoadingOlder(false);
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - prevHeight;
    });
  }

  async function ensureChannel(): Promise<string | null> {
    if (cid) return cid;
    if (!taskId) return null;
    const { data, error: err } = await supabase.rpc("chat_open_task_thread", { p_task: taskId });
    if (err || !data) {
      setError(err?.message || "Could not start the discussion.");
      return null;
    }
    setCid(data as string);
    return data as string;
  }

  async function send(body: string, mentions: string[], attachments: ChatAttachment[]) {
    const id = await ensureChannel();
    if (!id) return false;
    stickToBottom.current = true;
    const { data, error: err } = await supabase
      .from("chat_messages")
      .insert([{ channel_id: id, sender_id: me, body, mentions, attachments }])
      .select("*")
      .single();
    if (err || !data) {
      setError(err?.message || "Could not send.");
      return false;
    }
    setMessages((list) => (list.some((x) => x.id === data.id) ? list : [...list, data as ChatMessage]));
    return true;
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-2 py-3"
      >
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading messages…
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-xs text-text-muted">
            <MessagesSquare className="h-6 w-6" />
            {taskId ? "No discussion yet. Questions, updates and files about this task go here." : "No messages yet. Say hello!"}
          </div>
        ) : (
          <>
            {hasMore && (
              <div className="mb-2 text-center">
                <button type="button" onClick={loadOlder} disabled={loadingOlder} className="text-[11px] font-semibold text-navy underline">
                  {loadingOlder ? "Loading…" : "Load earlier messages"}
                </button>
              </div>
            )}
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
              const showHeader = newDay || !prev || prev.sender_id !== m.sender_id || new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() > 5 * 60 * 1000;
              return (
                <Fragment key={m.id}>
                  {newDay && (
                    <div className="my-3 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                      <span className="h-px flex-1 bg-border" />
                      {dayLabel(m.created_at)}
                      <span className="h-px flex-1 bg-border" />
                    </div>
                  )}
                  <ChatMessageView m={m} names={names} me={me} isAdmin={isAdmin} showHeader={showHeader} />
                </Fragment>
              );
            })}
          </>
        )}
      </div>
      {error && <p className="px-3 pb-1 text-[11px] text-rose-600">{error}</p>}
      <ChatComposer people={people} me={me} placeholder={placeholder} ensureChannel={ensureChannel} onSend={send} />
    </div>
  );
}