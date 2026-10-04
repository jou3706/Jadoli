import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Proof that this site really is the Android app, for the app to ask about.
 *
 * Android will not launch a Trusted Web Activity as a real window - no address
 * bar, no browser chrome - until it can check this file against the certificate
 * the APK was signed with. Without it the app still opens, but Chrome shows the
 * URL and an "app not verified" warning on every launch, which is not something
 * worth shipping to someone using it as their timetable.
 *
 * The fingerprint is not knowable before the keystore exists, and it is
 * different for debug and release builds, so both come from the environment
 * rather than being written into the repository. Unconfigured means answering
 * 404: an empty or half-filled file is worse than none, because a site that
 * claims a package name it cannot prove is a claim that fails for the wrong
 * reason.
 */
export async function GET() {
  const packageName = process.env.ANDROID_PACKAGE_NAME;
  const fingerprint = process.env.ANDROID_SHA256_FINGERPRINT;

  if (!packageName || !fingerprint) {
    return new NextResponse(null, { status: 404 });
  }

  // A fingerprint is a base64 SHA-256 of the signing certificate, colon
  // separated. Bubblewrap prints it in that shape; accepting the unseparated
  // form too means pasting either of the two things everyone actually has.
  const normalized = fingerprint.includes(":")
    ? fingerprint
    : fingerprint.replace(/(.{2})(?=.)/g, "$1:");

  return NextResponse.json(
    [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: packageName,
          sha256_cert_fingerprints: [normalized],
        },
      },
    ],
    {
      headers: {
        // Digital Asset Links is read by the installer, which is not a browser
        // and does not revalidate. This is the one response in the app that has
        // to be fresh every time.
        "cache-control": "no-cache, no-store, must-revalidate",
        "content-type": "application/json",
      },
    },
  );
}