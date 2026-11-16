/** Exercise the isolated preview sign-in before existing design-only journeys. */
export async function viewConceptRevision(page, label) {
  await page.getByRole("button", { name: "设计历程", exact: true }).click();
  const branch = page.locator(".vhistory-versions > details[open]");
  await branch
    .locator(".vversion-track button")
    .filter({
      has: page.locator("b").filter({ hasText: new RegExp(`^${label}$`) }),
    })
    .click();
  await page
    .getByRole("dialog", { name: "设计历程", exact: true })
    .waitFor({ state: "hidden" });
}

export async function enterPreviewDesign(
  page,
  base = "http://127.0.0.1:3108/v8",
) {
  if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
    throw Error("Local preview only");
  await page.goto(base);
  const signIn = page.getByRole("heading", { name: "登录工作空间" });
  const workspace = page.getByRole("heading", { name: "让想法，连接起来。" });
  await signIn.or(workspace).waitFor();
  if (await signIn.isVisible()) {
    await page.getByLabel("账户", { exact: true }).fill("123");
    await page.getByLabel("密码", { exact: true }).fill("123");
    await page
      .getByRole("button", { name: "进入工作空间", exact: true })
      .click();
  }
  await page.getByRole("heading", { name: "让想法，连接起来。" }).waitFor();
  await page.getByRole("button", { name: "进入 Embodex", exact: true }).click();
  await page.getByRole("heading", { name: "今天，想设计什么？" }).waitFor();
}
