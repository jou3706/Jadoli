"use client";

import { useCallback } from "react";
import { authHeader } from "@/lib/db/supabase-client";
import { detectKind } from "@/lib/materials";
import type { Material } from "@/lib/db/types";

/**
 * The two things the read buttons on a material row have in common.
 *
 * Both a summary and a full set of notes are the same shape of work - ask a
 * route to read a file this app holds, and get the file's own words back - so
 * the parts that are not about what is being asked for live here once.
 */

/** Today's date, in the reader's language, with Latin digits like the rest of the app. */
export function todayLabel(language: "ar" | "en"): string {
  try {
    return new Intl.DateTimeFormat(language === "ar" ? "ar" : "en-GB", {
      dateStyle: "long",
      numberingSystem: "latn",
    }).format(new Date());
  } catch {
    return "";
  }
}

/**
 * Whether this material has something to read.
 *
 * Only a file this app holds can be read: the routes fetch it through the
 * student's own storage, and a link has no file behind it.
 */
export function canSummarise(material: Material | null): material is Material {
  return !!material?.file_path && detectKind(material.url, material.type) !== "video";
}

/**
 * Ask a route to read a file, and get its answer back typed.
 *
 * The routes tidy their own reply before responding, so what comes back is the
 * shape the caller asks for. The routes answer with a message written for a
 * student rather than for a log, so an error is passed on as it is: replacing it
 * with something vaguer here would be the one place the reason a file could not
 * be read gets lost.
 */
export function useMaterialRead() {
  return useCallback(
    async function read<T>(
      material: Material,
      route: string,
      language: "ar" | "en",
    ): Promise<T> {
      const res = await fetch(route, {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ materialId: material.id, language }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          body.message || body.reason || body.error || "the file could not be read",
        );
      }
      return body as T;
    },
    [],
  );
}