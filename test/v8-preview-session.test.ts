import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PREVIEW_SESSION_KEY,
  endPreviewSession,
  hasPreviewSession,
  isPreviewCredentials,
  startPreviewSession,
} from "../lib/v8/preview-session";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

test("Preview login accepts only the requested example credentials", () => {
  assert.equal(isPreviewCredentials("123", "123"), true);
  assert.equal(isPreviewCredentials(" 123 ", "123"), true);
  for (const [account, password] of [
    ["", ""],
    ["123", ""],
    ["1234", "123"],
    ["123", "1234"],
    ["123", " 123"],
    ["123", "123 "],
  ]) {
    assert.equal(isPreviewCredentials(account, password), false);
  }
});

test("Malformed, missing, and unrelated preview session markers are rejected", () => {
  const storage = new MemoryStorage();
  assert.equal(hasPreviewSession(storage), false);
  for (const marker of [
    "not-json",
    "null",
    "true",
    "123",
    "[]",
    "{}",
    '{"version":2,"account":"123"}',
    '{"version":1,"account":"other"}',
    '{"version":1,"account":123}',
  ]) {
    storage.setItem(PREVIEW_SESSION_KEY, marker);
    assert.equal(hasPreviewSession(storage), false);
  }
});

test("Preview login persists an account marker without password or identity tokens", () => {
  const storage = new MemoryStorage();
  startPreviewSession(storage);
  assert.equal(hasPreviewSession(storage), true);
  assert.deepEqual(JSON.parse(storage.getItem(PREVIEW_SESSION_KEY)!), {
    version: 1,
    account: "123",
  });
  assert.equal(storage.values.size, 1);
});

test("Preview logout removes its own marker while preserving projects and workspace choices", () => {
  const storage = new MemoryStorage();
  storage.setItem(
    "embodex-v8-preview-v1",
    '{"projects":[{"id":"saved-project"}]}',
  );
  storage.setItem("embomix-workspace", '{"modules":["embodex","simcore"]}');
  const before = new Map(storage.values);
  startPreviewSession(storage);
  endPreviewSession(storage);
  assert.equal(hasPreviewSession(storage), false);
  assert.deepEqual(storage.values, before);
  endPreviewSession(storage);
  assert.deepEqual(storage.values, before);
});
