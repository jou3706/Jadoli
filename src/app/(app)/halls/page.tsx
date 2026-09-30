"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  ExternalLink,
  MapPin,
  Navigation,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useList, useMutate } from "@/lib/db/store";
import { useToast } from "@/components/ui/toast";
import { CAMPUSES, DEFAULT_CAMPUS } from "@/lib/constants";
import { cn, nowCairo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Hall } from "@/lib/db/types";

type Draft = {
  id?: string;
  name: string;
  campus: string;
  lat: string;
  lng: string;
  note: string;
};

const EMPTY: Draft = { name: "", campus: DEFAULT_CAMPUS, lat: "", lng: "", note: "" };

function HallForm({
  open,
  onOpenChange,
  hall,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  hall: Hall | null;
}) {
  const { tr } = useI18n();
  const { create, update } = useMutate("Hall");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDirty(false);
    setError("");
    setDraft(EMPTY);
  }, [open, hall]);

  const d: Draft = dirty
    ? draft
    : hall
      ? {
          id: hall.id,
          name: hall.name,
          campus: hall.campus,
          lat: hall.lat == null ? "" : String(hall.lat),
          lng: hall.lng == null ? "" : String(hall.lng),
          note: hall.note,
        }
      : EMPTY;

  const set = <K extends keyof Draft>(k: K, v: string) => {
    setDirty(true);
    setDraft((p) => ({ ...p, [k]: v }));
  };

  const pickCampus = (key: string) => {
    const c = CAMPUSES.find((x) => x.key === key);
    setDirty(true);
    setDraft((p) => ({
      ...p,
      campus: key,
      lat: String(c?.center[0] ?? ""),
      lng: String(c?.center[1] ?? ""),
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl">
            {d.id ? tr("تعديل قاعة", "Edit hall") : tr("إضافة قاعة", "Add hall")}
          </DialogTitle>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!d.name.trim()) {
              setError(tr("اكتب اسم القاعة", "Enter the hall name"));
              return;
            }
            setError("");
            const lat = d.lat ? Number(d.lat) : null;
            const lng = d.lng ? Number(d.lng) : null;
            if ((lat == null) !== (lng == null)) {
              setError(tr("اكتب خط الطول والعرض مع بعض", "Latitude and longitude go together"));
              return;
            }
            if (
              lat != null &&
              lng != null &&
              (lat < -90 || lat > 90 || lng < -180 || lng > 180)
            ) {
              setError(tr("الإحداثيات خارج النطاق", "Coordinates out of range"));
              return;
            }
            const payload = {
              name: d.name.trim(),
              campus: d.campus,
              lat,
              lng,
              note: d.note.trim(),
              streetview_url:
                lat != null && lng != null
                  ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`
                  : "",
            };
            if (d.id) await update(d.id, payload);
            else await create(payload);
            setDirty(false);
            onOpenChange(false);
          }}
        >
          <Field label={tr("اسم القاعة", "Hall name")}>
            <Input
              value={d.name}
              onChange={(e) => set("name", e.target.value)}
              className="h-11 text-base"
              autoFocus
            />
          </Field>

          <Field label={tr("الكمبوس", "Campus")}>
            <Select value={d.campus} onChange={(e) => pickCampus(e.target.value)}>
              {CAMPUSES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Latitude">
              <Input
                type="number"
                step="any"
                value={d.lat}
                onChange={(e) => set("lat", e.target.value)}
                className="h-11 text-base"
                dir="ltr"
              />
            </Field>
            <Field label="Longitude">
              <Input
                type="number"
                step="any"
                value={d.lng}
                onChange={(e) => set("lng", e.target.value)}
                className="h-11 text-base"
                dir="ltr"
              />
            </Field>
          </div>

          <Field label={tr("ملاحظة", "Note")}>
            <Textarea
              value={d.note}
              onChange={(e) => set("note", e.target.value)}
              className="text-base"
              rows={2}
            />
          </Field>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tr("إلغاء", "Cancel")}
            </Button>
            <Button type="submit" className="h-12 text-base">
              {tr("حفظ", "Save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function HallsPage() {
  const { tr } = useI18n();
  const toast = useToast();
  const { data: halls = [] } = useList("Hall", "name", 300);
  const { data: lectures = [] } = useList("Lecture", "-created_date", 300);
  const { remove } = useMutate("Hall");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Hall | null>(null);
  const [campus, setCampus] = useState<string>(DEFAULT_CAMPUS);

  const [now, setNow] = useState(() => nowCairo());
  const todayKey = String(now.getDay());

  useEffect(() => {
    const id = setInterval(() => setNow(nowCairo()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Which halls are in use right now / later today.
  const busyNow = useMemo(() => {
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(
      now.getMinutes(),
    ).padStart(2, "0")}`;
    return new Set(
      lectures
        .filter(
          (l) =>
            String(l.day) === todayKey &&
            l.hall &&
            l.start_time <= hhmm &&
            hhmm < l.end_time,
        )
        .map((l) => l.hall as string),
    );
  }, [lectures, todayKey, now]);

  const upcoming = useMemo(() => {
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(
      now.getMinutes(),
    ).padStart(2, "0")}`;
    return new Set(
      lectures
        .filter((l) => String(l.day) === todayKey && l.hall && l.start_time > hhmm)
        .map((l) => l.hall as string),
    );
  }, [lectures, todayKey, now]);

  const shown = halls.filter((h) => h.campus === campus);
  const campusInfo = CAMPUSES.find((c) => c.key === campus);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[32px] font-bold text-foreground">
            {tr("الخريطة والقاعات", "Map & halls")}
          </h1>
          <p className="text-base text-muted-foreground">
            {tr("دوّر على قاعتك وامشي عليها", "Find your hall and get there")}
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4" /> {tr("قاعة جديدة", "Add hall")}
        </Button>
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl border bg-card p-1">
        {CAMPUSES.map((c) => (
          <button
            key={c.key}
            onClick={() => setCampus(c.key)}
            className={cn(
              "rounded-lg px-3 py-2 text-sm font-bold transition-colors",
              campus === c.key ? "bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border bg-card">
        <iframe
          key={campus}
          title={campusInfo?.label ?? "map"}
          className="h-64 w-full border-0"
          loading="lazy"
          src={`https://www.openstreetmap.org/export/embed.html?bbox=${
            campusInfo
              ? `${campusInfo.center[1] - 0.012},${campusInfo.center[0] - 0.012},${
                  campusInfo.center[1] + 0.012
                },${campusInfo.center[0] + 0.012}`
              : "31.2,31.6,31.7,31.65"
          }&layer=mapnik&marker=${
            campusInfo ? `${campusInfo.center[0]},${campusInfo.center[1]}` : ""
          }`}
        />
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-card p-10 text-center text-muted-foreground">
          {tr(
            "مفيش قاعات مسجلة في هذا الكمبوس — ضيف أول واحدة.",
            "No halls saved for this campus — add the first one.",
          )}
        </p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {shown.map((h) => {
            const active = busyNow.has(h.name);
            const later = upcoming.has(h.name);
            const campusCenter = CAMPUSES.find((c) => c.key === h.campus)?.center;
            const origin =
              campusCenter && h.lat != null && h.lng != null
                ? `${campusCenter[0]},${campusCenter[1]}`
                : null;
            const dest =
              h.lat != null && h.lng != null ? `${h.lat},${h.lng}` : null;
            const directions =
              origin && dest
                ? `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=walking`
                : null;
            return (
              <li
                key={h.id}
                className={cn(
                  "flex items-start gap-3 rounded-2xl border bg-card p-4",
                  active && "border-emerald-500/50 bg-emerald-500/5",
                )}
              >
                <Building2
                  className={cn(
                    "mt-0.5 h-5 w-5 shrink-0",
                    active ? "text-emerald-600" : "text-primary",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{h.name}</p>
                    {active && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                        {tr("فيها محاضرة دلوقتي", "In class now")}
                      </span>
                    )}
                    {!active && later && (
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700">
                        {tr("فيها بعدين", "Later today")}
                      </span>
                    )}
                  </div>
                  {h.note && (
                    <p className="mt-0.5 text-sm text-muted-foreground">{h.note}</p>
                  )}
                  {h.lat != null && h.lng != null && (
                    <p className="mt-0.5 text-xs text-muted-foreground tabular-nums" dir="ltr">
                      <MapPin className="me-1 inline h-3 w-3" />
                      {h.lat.toFixed(5)}, {h.lng.toFixed(5)}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {directions && (
                      <Button asChild size="sm" variant="outline">
                        <a href={directions} target="_blank" rel="noopener noreferrer">
                          <Navigation className="h-3.5 w-3.5" />{" "}
                          {tr("اتجاهات", "Directions")}
                        </a>
                      </Button>
                    )}
                    {h.streetview_url && (
                      <Button asChild size="sm" variant="ghost">
                        <a
                          href={h.streetview_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />{" "}
                          {tr("ستريت فيو", "Street view")}
                        </a>
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => {
                        setEditing(h);
                        setOpen(true);
                      }}
                      aria-label={tr("تعديل", "Edit")}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive"
                      onClick={() =>
                        void remove(h.id).then(() =>
                          toast({ title: tr("اتحذفت القاعة", "Hall deleted") }),
                        )
                      }
                      aria-label={tr("حذف", "Delete")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <HallForm open={open} onOpenChange={setOpen} hall={editing} />
    </div>
  );
}
