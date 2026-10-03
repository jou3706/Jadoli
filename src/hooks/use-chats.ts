"use client";

import { useCallback, useMemo, useState } from "react";
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
  const { data: chats } = useList("Chat", "-updated_date", MAX_CHATS);
  // Opening the assistant always starts a fresh, unsaved thread. Past
  // conversations are not gone — they are in the list and open when picked —
  // they are just never reopened automatically.
  const [activeId, setActiveId] = useState<Id | null>(null);

  const { data: messages } = useFilter(
    "Message",
    { chat_id: activeId ?? NO_CHAT },
    "created_date",
    MAX_MESSAGES,
    [activeId],
  );

  const chat = useMutate("Chat");
  const msg = useMutate("Message");

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
