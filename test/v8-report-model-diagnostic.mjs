import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
const output = resolve("test-results/v8-report-model-diagnostic");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
try {
  await page.goto(
    "http://127.0.0.1:3108/v8/projects/demo-example-q4-inspection/delivery",
  );
  await page.getByRole("heading", { name: "设计成果", exact: true }).waitFor();
  await page.getByRole("button", { name: "查看完整方案", exact: true }).click();
  const dialog = page.getByRole("dialog", {
      name: "完整设计方案",
      exact: true,
    }),
    frame = dialog.locator("iframe").contentFrame();
  await frame.locator('.chapters a[href="#interactive"]').click();
  const model = frame.locator(
    '#report-interactive-host [data-model-loaded="true"]',
  );
  await model.waitFor();
  await page.waitForTimeout(500);
  const data = await model.evaluate((el) => {
    const map = (node) => {
      const s = getComputedStyle(node),
        b = node.getBoundingClientRect();
      return {
        tag: node.tagName,
        class: node.className,
        rect: { x: b.x, y: b.y, width: b.width, height: b.height },
        client: { w: node.clientWidth, h: node.clientHeight },
        style: Object.fromEntries(
          [
            "display",
            "visibility",
            "opacity",
            "position",
            "height",
            "width",
            "overflow",
            "zIndex",
          ].map((k) => [k, s[k]]),
        ),
      };
    };
    const canvas = el.querySelector("canvas"),
      context2d = el.dataset.rendererPresentation?.startsWith("live-webgl")
        ? canvas.getContext("2d")
        : null,
      gl = context2d
        ? null
        : canvas.getContext("webgl2") || canvas.getContext("webgl");
    let min = 255,
      max = 0,
      unique = new Set();
    const pixels = context2d
      ? context2d.getImageData(0, 0, canvas.width, canvas.height).data
      : new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    if (gl)
      gl.readPixels(
        0,
        0,
        gl.drawingBufferWidth,
        gl.drawingBufferHeight,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels,
      );
    for (let i = 0; i < pixels.length; i += 64) {
      min = Math.min(min, pixels[i]);
      max = Math.max(max, pixels[i]);
      unique.add([pixels[i], pixels[i + 1], pixels[i + 2]].join(","));
    }
    const chain = [];
    for (let n = el; n && chain.length < 6; n = n.parentElement)
      chain.push(map(n));
    const b = canvas.getBoundingClientRect();
    return {
      dataset: { ...el.dataset },
      chain,
      canvas: map(canvas),
      buffer: {
        w: canvas.width,
        h: canvas.height,
        glw: gl?.drawingBufferWidth,
        glh: gl?.drawingBufferHeight,
        lost: gl?.isContextLost(),
        framebufferBinding: gl
          ? gl.getParameter(gl.FRAMEBUFFER_BINDING) === null
            ? "default"
            : "offscreen"
          : undefined,
        attributes: gl?.getContextAttributes(),
        min,
        max,
        unique: unique.size,
      },
      hit: el.ownerDocument
        .elementsFromPoint(b.x + b.width / 2, b.y + b.height / 2)
        .slice(0, 8)
        .map((n) => ({
          tag: n.tagName,
          class: n.className,
          background: getComputedStyle(n).backgroundColor,
        })),
      layers: [...el.closest("section").children].map((n) => ({
        class: n.className,
        background: getComputedStyle(n).backgroundColor,
        filter: getComputedStyle(n).filter,
        transform: getComputedStyle(n).transform,
        opacity: getComputedStyle(n).opacity,
      })),
      activeChapter: el.ownerDocument
        .querySelector(".chapters [aria-current]")
        ?.getAttribute("href"),
      sectionTop: el.ownerDocument
        .getElementById("interactive")
        .getBoundingClientRect().top,
    };
  });
  await writeFile(
    join(output, "diagnostic.json"),
    JSON.stringify(data, null, 2),
  );
  await page.screenshot({
    path: join(output, "inline-model.png"),
    fullPage: true,
  });
  console.log(JSON.stringify(data));
  const encoded = await model
    .locator("canvas")
    .evaluate((canvas) => canvas.toDataURL("image/png"));
  await writeFile(
    join(output, "canvas-readback.png"),
    Buffer.from(encoded.split(",")[1], "base64"),
  );
  await model
    .locator("canvas")
    .evaluate((el) => (el.style.transform = "translateZ(0)"));
  await page.waitForTimeout(300);
  await page.screenshot({
    path: join(output, "inline-model-layer.png"),
    fullPage: true,
  });
  await model.evaluate((el) => {
    const doc = el.ownerDocument;
    const canvas = doc.createElement("canvas");
    canvas.width = 100;
    canvas.height = 100;
    canvas.style.cssText =
      "position:fixed;left:20px;top:80px;width:100px;height:100px;z-index:999999";
    canvas.getContext("2d").fillStyle = "red";
    canvas.getContext("2d").fillRect(0, 0, 100, 100);
    doc.body.appendChild(canvas);
    const div = doc.createElement("div");
    div.style.cssText =
      "position:fixed;left:130px;top:80px;width:100px;height:100px;background:lime;z-index:999999";
    doc.body.appendChild(div);
  });
  await page.waitForTimeout(100);
  await page.screenshot({
    path: join(output, "canvas-vs-div-presentation.png"),
    fullPage: true,
  });
} finally {
  await context.close();
  await browser.close();
}
