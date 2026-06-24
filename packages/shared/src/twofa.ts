/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Two-factor authentication (TOTP) wire contracts shared by backend ⇄ frontend.
 * Secrets/recovery codes appear here ONLY in the one-time enrolment responses;
 * they are never persisted in plaintext and never re-served afterwards.
 */

/** Current 2FA state for the authenticated user (GET /api/me/2fa). */
export interface TwoFAStatus {
  /** Whether the user has completed TOTP enrolment. */
  enabled: boolean;
  /** Whether the platform requires 2FA (security.require2fa setting). */
  required: boolean;
}

/** Response to POST /api/me/2fa/setup — the pending secret to enrol in an app. */
export interface TwoFASetupResponse {
  /** base32 shared secret (shown once for manual entry). */
  secret: string;
  /** otpauth:// provisioning URI (for QR / one-tap import). */
  otpauthUri: string;
}

/** Response to POST /api/me/2fa/enable — recovery codes shown exactly once. */
export interface TwoFAEnableResponse {
  recoveryCodes: string[];
}
