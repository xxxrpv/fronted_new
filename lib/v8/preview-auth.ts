/** Local demonstration only. Production authentication continues through the platform API. */
export const PREVIEW_ACCOUNTS_KEY = "embomix-v8-preview-accounts-v1";
export const PREVIEW_SMS_CODE = "123456";
export type PreviewProfile = {
  phone: string;
  email?: string;
  organization?: string;
  salt?: string;
  hash?: string;
};
type Store = Pick<Storage, "getItem" | "setItem">;
export const normalizePreviewPhone = (value: string) =>
  value.replace(/[\s-]/g, "").replace(/^\+86/, "");
export const validPreviewPhone = (value: string) =>
  /^1[3-9]\d{9}$/.test(normalizePreviewPhone(value));
export function previewProfiles(
  storage: Pick<Store, "getItem">,
): PreviewProfile[] {
  try {
    const data = JSON.parse(storage.getItem(PREVIEW_ACCOUNTS_KEY) || "[]");
    return Array.isArray(data)
      ? data.filter(
          (p) => p && typeof p.phone === "string" && validPreviewPhone(p.phone),
        )
      : [];
  } catch {
    return [];
  }
}
async function digest(password: string, salt: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const result = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode(salt),
      iterations: 100000,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return Array.from(new Uint8Array(result), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function savePreviewAccount(
  storage: Store,
  profile: PreviewProfile,
  password: string,
  reset = false,
) {
  const phone = normalizePreviewPhone(profile.phone);
  if (!validPreviewPhone(phone)) throw new Error("请输入有效的手机号。");
  if (password.length < 8 || password.length > 128)
    throw new Error("密码需为 8–128 位。");
  const profiles = previewProfiles(storage);
  const existing = profiles.find((p) => p.phone === phone);
  if (reset && !existing)
    throw new Error("当前浏览器中没有这个账户，请先注册。");
  if (!reset && existing) throw new Error("此手机号已注册，请登录或找回密码。");
  const salt = crypto.randomUUID();
  const next = {
    ...existing,
    ...profile,
    phone,
    salt,
    hash: await digest(password, salt),
  };
  storage.setItem(
    PREVIEW_ACCOUNTS_KEY,
    JSON.stringify([...profiles.filter((p) => p.phone !== phone), next]),
  );
  return phone;
}
export async function authenticatePreviewAccount(
  storage: Pick<Store, "getItem">,
  account: string,
  password: string,
) {
  if (account.trim() === "123" && password === "123") return "123";
  const query = normalizePreviewPhone(account.trim());
  const found = previewProfiles(storage).find(
    (p) =>
      p.phone === query ||
      p.email?.toLowerCase() === account.trim().toLowerCase(),
  );
  if (
    found?.salt &&
    found.hash &&
    (await digest(password, found.salt)) === found.hash
  )
    return found.phone;
  throw new Error("账户或密码不正确。");
}
export function previewSmsAccount(
  storage: Pick<Store, "getItem">,
  phone: string,
) {
  const normalized = normalizePreviewPhone(phone);
  if (!previewProfiles(storage).some((p) => p.phone === normalized))
    throw new Error("当前浏览器中没有这个账户，请先注册。");
  return normalized;
}
