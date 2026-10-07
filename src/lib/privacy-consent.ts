const CONSENT_KEY = "jadoli_privacy_consent";
const CONSENT_VERSION = "1";

/**
 * Whether this browser already accepted the current privacy policy.
 *
 * The version is part of the stored value, so editing the policy and bumping
 * CONSENT_VERSION forces everyone to accept the new text before continuing.
 */
export function hasPrivacyConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === CONSENT_VERSION;
  } catch {
    return false;
  }
}

export function markPrivacyConsent(): void {
  try {
    localStorage.setItem(CONSENT_KEY, CONSENT_VERSION);
  } catch {
    /* ignore */
  }
}