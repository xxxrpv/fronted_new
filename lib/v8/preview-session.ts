/** Browser-local demo access, used only by the server-guarded development preview. */
import { previewProfiles } from "./preview-auth";
export const PREVIEW_SESSION_KEY = "embomix-v8-preview-session-v1";
export const PREVIEW_ACCOUNT = "123";

type PreviewStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function isPreviewCredentials(
  account: string,
  password: string,
): boolean {
  return account.trim() === PREVIEW_ACCOUNT && password === "123";
}

export function hasPreviewSession(
  storage: Pick<PreviewStorage, "getItem">,
): boolean {
  try {
    const value = JSON.parse(storage.getItem(PREVIEW_SESSION_KEY) || "null");
    return (
      (value?.version === 1 && value?.account === PREVIEW_ACCOUNT) ||
      (value?.version === 2 &&
        previewProfiles(storage).some((p) => p.phone === value.account))
    );
  } catch {
    return false;
  }
}

export function startPreviewSession(
  storage: Pick<PreviewStorage, "setItem">,
  account = PREVIEW_ACCOUNT,
): void {
  storage.setItem(
    PREVIEW_SESSION_KEY,
    JSON.stringify({ version: account === PREVIEW_ACCOUNT ? 1 : 2, account }),
  );
}

export function endPreviewSession(
  storage: Pick<PreviewStorage, "removeItem">,
): void {
  storage.removeItem(PREVIEW_SESSION_KEY);
}
