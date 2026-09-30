"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useFilter, useList, useMutate } from "@/lib/db/store";
import type { Id, Message } from "@/lib/db/types";

export type StoredTurn = {
  id: Id;
  role: "user" | "assistant";
  text: string;
};

/**
 * Assistant conversations. Every question and answer is written to the `Chat`
 * and `Message` entities, so a refresh (or a second device) keeps the thread.
 */
const MAX_CHATS = 40;
const MAX_MESSAGES = 500;
/** localStorage is ~5MB; attachments are never stored, only text. */
const MAX_TEXT = 8000;
/** Never matches a real uuid, used to query "no chat selected". */
const NO_CHAT = "00000000-0000-0000-0000-000000000000";

export function useChats() {
  const { data: chats, isLoading } = useList("Chat", "-updated_date", MAX_CHATS);
  // `undefined` = not initialised yet, `null` = an empty new chat.
  const [activeId, setActiveId] = useState<Id | null | undefined>(undefined);

  const { data: messages } = useFilter(
    "Message",
    { chat_id: activeId ?? NO_CHAT },
    "created_date",
    MAX_MESSAGES,
    [activeId],
  );

  const chat = useMutate("Chat");
  const msg = useMutate("Message");

  // Open the newest thread on first load; afterwards a `null` selection is the
  // user's explicit "new chat", so it must not be overridden.
  useEffect(() => {
    if (isLoading || activeId !== undefined) return;
    setActiveId(chats?.[0]?.id ?? null);
  }, [isLoading, chats, activeId]);

  const turns = useMemo<StoredTurn[]>(
    () =>
      (messages ?? []).map((m: Message) => ({
        id: m.id,
        role: m.role,
        text: m.text,
      })),
    [messages],
  );

  const newChat = useCallback(() => setActiveId(null), []);

  const openChat = useCallback((id: Id) => setActiveId(id), []);

  /**
   * Returns the id of the active chat, creating one on first use. Touching
   * `updated_date` on every question is what keeps the sidebar sorted.
   */
  const ensureChat = useCallback(
    async (title: string) => {
      if (activeId) {
        await chat.update(activeId, {
          updated_date: new Date().toISOString(),
        });
        return activeId;
      }
      const created = await chat.create({
        title: title.replace(/\s+/g, " ").trim().slice(0, 60),
        sort_order: 0,
      });
      setActiveId(created.id);
      return created.id;
    },
    [activeId, chat],
  );

  const saveMessage = useCallback(
    async (chatId: Id, role: "user" | "assistant", text: string) => {
      await msg.create({
        chat_id: chatId,
        role,
        text: text.slice(0, MAX_TEXT),
      });
    },
    [msg],
  );

  const deleteChat = useCallback(
    async (id: Id) => {
      await chat.remove(id);
      await msg.deleteMany({ chat_id: id });
      setActiveId((cur) => (cur === id ? null : cur));
    },
    [chat, msg],
  );

  const renameChat = useCallback(
    (id: Id, title: string) => chat.update(id, { title: title.slice(0, 60) }),
    [chat],
  );

  return {
    chats: chats ?? [],
    isLoading,
    activeId: activeId ?? null,
    turns,
    newChat,
    openChat,
    ensureChat,
    saveMessage,
    deleteChat,
    renameChat,
  };
}
