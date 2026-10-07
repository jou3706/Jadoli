/**
 * Whether a signed-in account has already seen the first-run guide.
 *
 * Kept out of the hook so the rules can be tested without a browser, and out of
 * the database because it is about the experience on one device, not the
 * account's data. Keyed by account, not by device, so two people on one laptop
 * each get their own first look. A brand-new key reads as "seen": every account
 * that predates the guide gets it once, and so does every account after them.
 */

const NS = "jadoli_onboard_seen";

export const readOnboardingSeen = (who: string): boolean => {
  try {
    return localStorage.getItem(`${NS}:${who}`) === "1";
  } catch {
    return false;
  }
};

export const markOnboardingSeen = (who: string): void => {
  try {
    localStorage.setItem(`${NS}:${who}`, "1");
  } catch {
    /* a blocked disk is not a reason to keep nagging the student */
  }
};