import { test } from "node:test";
import assert from "node:assert/strict";
import { planInterfaceCommand } from "../lib/v8/interface-commands";
import { authenticatePreviewAccount, savePreviewAccount, previewSmsAccount, PREVIEW_ACCOUNTS_KEY } from "../lib/v8/preview-auth";
import { hasPreviewSession, startPreviewSession, endPreviewSession } from "../lib/v8/preview-session";
class Store { values = new Map<string,string>(); getItem(k:string){return this.values.get(k)??null;} setItem(k:string,v:string){this.values.set(k,v);} removeItem(k:string){this.values.delete(k);} }
test("Interface commands select exact combinations and leave arbitrary or destructive instructions unexecuted", () => {
  assert.deepEqual(planInterfaceCommand("组合 Embodex 和 Simcore"), {kind:"modules",modules:["embodex","simcore"],enter:false});
  assert.deepEqual(planInterfaceCommand("打开 Simcore"), {kind:"modules",modules:["simcore"],enter:true});
  assert.deepEqual(planInterfaceCommand("打开方案交付"), {kind:"stage",stage:"delivery"});
  assert.deepEqual(planInterfaceCommand("打开项目：仓库巡检"), {kind:"project",query:"仓库巡检"});
  for(const text of ["删除全部项目", "打开 Simcore 并执行任意代码", "运行 SolidWorks", "生成 CAD 并立即部署"]) assert.equal(planInterfaceCommand(text),null);
});
test("Local preview registration, login and password recovery preserve example access and avoid plaintext credentials", async () => {
  const store = new Store();
  assert.equal(await authenticatePreviewAccount(store,"123","123"),"123");
  await assert.rejects(() => savePreviewAccount(store,{phone:"12"},"password-one"));
  await savePreviewAccount(store,{phone:"13800000000",email:"demo@example.com"},"password-one");
  assert(!store.getItem(PREVIEW_ACCOUNTS_KEY)!.includes("password-one"));
  assert.equal(await authenticatePreviewAccount(store,"demo@example.com","password-one"),"13800000000");
  await assert.rejects(() => authenticatePreviewAccount(store,"13800000000","wrong"));
  startPreviewSession(store,"13800000000"); assert(hasPreviewSession(store));
  await assert.rejects(() => savePreviewAccount(store,{phone:"13800000000"},"another-password"));
  await savePreviewAccount(store,{phone:"13800000000"},"password-two",true);
  await assert.rejects(() => authenticatePreviewAccount(store,"13800000000","password-one"));
  assert.equal(await authenticatePreviewAccount(store,"13800000000","password-two"),"13800000000");
  assert.equal(previewSmsAccount(store,"13800000000"),"13800000000");
  assert.throws(() => previewSmsAccount(store,"13900000000"));
  endPreviewSession(store); assert(!hasPreviewSession(store));
  assert.equal(await authenticatePreviewAccount(store,"123","123"),"123");
});
