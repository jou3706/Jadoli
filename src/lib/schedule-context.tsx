"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Lecture } from "@/lib/db/types";
import { LectureFormDialog } from "@/components/schedule/lecture-form";

type ScheduleContextValue = {
  editMode: boolean;
  setEditMode: (v: boolean | ((p: boolean) => boolean)) => void;
  search: string;
  setSearch: (v: string) => void;
  /** Opens the lecture dialog, optionally pre-filled for editing. */
  openForm: (lecture?: Lecture | null) => void;
};

const ScheduleContext = createContext<ScheduleContextValue | null>(null);

export function ScheduleProvider({ children }: { children: ReactNode }) {
  const [editMode, setEditMode] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<{
    open: boolean;
    lecture: Lecture | null;
  }>({ open: false, lecture: null });

  const value = useMemo<ScheduleContextValue>(
    () => ({
      editMode,
      setEditMode,
      search,
      setSearch,
      openForm: (lecture = null) => setForm({ open: true, lecture }),
    }),
    [editMode, search],
  );

  return (
    <ScheduleContext.Provider value={value}>
      {children}
      <FormSlot form={form} setForm={setForm} />
    </ScheduleContext.Provider>
  );
}

function FormSlot({
  form,
  setForm,
}: {
  form: { open: boolean; lecture: Lecture | null };
  setForm: (f: { open: boolean; lecture: Lecture | null }) => void;
}) {
  return (
    <LectureFormDialog
      open={form.open}
      lecture={form.lecture}
      onOpenChange={(open) => setForm({ ...form, open })}
    />
  );
}

export function useScheduleContext() {
  const ctx = useContext(ScheduleContext);
  if (!ctx) {
    throw new Error("useScheduleContext must be used inside <ScheduleProvider>");
  }
  return ctx;
}
