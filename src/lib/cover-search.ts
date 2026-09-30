/**
 * Turning a course name into Wikimedia Commons cover candidates.
 *
 * Kept free of React and of the network so the ranking is unit tested; the
 * route in src/app/api/cover/search only does the fetch.
 */

export type CoverCandidate = {
  title: string;
  /** 1024px-wide thumbnail, ready to download. */
  thumb: string;
  /** Commons description page, for "where did this come from". */
  page: string;
  width: number;
  height: number;
  license: string;
  artist: string;
  /** True for images we may reuse without crediting. */
  free: boolean;
};

/** Course codes, semester tags and numbers only add noise to the search. */
export function coverQuery(subject: string): string {
  const cleaned = (subject ?? "")
    .replace(/\b\d+\b/g, " ") // "Calculus 2" -> "Calculus"
    .replace(/\b[ก-๛]{2,}\b/gu, " ") // stray non-latin words
    .replace(/[^\p{L}\s&-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${cleaned || "university"} filetype:bitmap`;
}

/** Book covers, scans and logos make poor course covers. */
const NOISE =
  /\b(cover|kapak|vol\.?|volume|textbook|handbook|manual|journal|encyclopedi|dictionary|edition|publisher|isbn|logo|coat of arms|flag|signature|stamp|banknote|postcard|advert)/i;
/** Files rendered from a PDF/DjVu are page images, not photographs. */
const RENDERED = /\/page\d+-|\.pdf\/|page1-/i;
const FREE_LICENCE = /^(public domain|cc0|cc pd|no restrictions|PDM-owner|attribution$)/i;

export const isFreeLicence = (licence: string) => FREE_LICENCE.test(licence.trim());

export function stripHtml(raw: string | undefined): string {
  return (raw ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/** Commons imageinfo, as far as the ranking cares. */
type Page = {
  title?: string;
  pageid?: number;
  imageinfo?:
    | {
        url?: string;
        thumburl?: string;
        descriptionurl?: string;
        mime?: string;
        width?: number;
        height?: number;
        extmetadata?: Record<string, { value?: string } | undefined>;
      }[]
    | undefined;
};

/**
 * Filters the noise and orders what is left. Free-licence images first, then
 * bigger ones — a 3500px photograph makes a better tile than a 300px book scan.
 */
export function rankCandidates(pages: Page[], subject: string): CoverCandidate[] {
  const word = (subject ?? "").toLowerCase().split(/\s+/).filter(Boolean)[0] ?? "";

  return pages
    .map((p) => {
      const info = p.imageinfo?.[0];
      const meta = info?.extmetadata ?? {};
      const thumb = info?.thumburl ?? "";
      const licence = stripHtml(meta.LicenseShortName?.value);
      return {
        title: (p.title ?? "").replace(/^File:/i, ""),
        thumb,
        page: info?.descriptionurl ?? "",
        width: info?.width ?? 0,
        height: info?.height ?? 0,
        mime: info?.mime ?? "",
        licence,
        artist: stripHtml(meta.Artist?.value),
        rendered: RENDERED.test(thumb) || /\.pdf$/i.test(p.title ?? ""),
      };
    })
    .filter((c) => {
      if (!c.thumb) return false;
      if (!/^image\/(jpeg|png|webp)$/i.test(c.mime)) return false;
      if (c.rendered) return false;
      if (NOISE.test(c.title)) return false;
      // Too small and the tile turns to mush.
      if (c.width < 600 || c.height < 400) return false;
      return true;
    })
    .map<CoverCandidate & { _rel: number; _free: number }>((c) => ({
      title: c.title,
      thumb: c.thumb,
      page: c.page,
      width: c.width,
      height: c.height,
      license: c.licence,
      artist: c.artist,
      free: isFreeLicence(c.licence),
      _free: isFreeLicence(c.licence) ? 1 : 0,
      // A title that repeats the subject is usually the diagram we want.
      _rel: word && c.title.toLowerCase().includes(word) ? 1 : 0,
    }))
    .sort(
      (a, b) =>
        b._free - a._free ||
        b._rel - a._rel ||
        b.width * b.height - a.width * a.height ||
        a.title.localeCompare(b.title),
    )
    .slice(0, 8)
    .map(({ _free, _rel, ...rest }) => rest);
}
