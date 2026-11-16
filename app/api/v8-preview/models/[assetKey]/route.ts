import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  exportConfiguredGlb,
  type ConfiguredGlbExport,
} from "../../../../../lib/v8/export-configured-glb";
import { parsePreviewModelRecipe } from "../../../../../lib/v8/preview-model-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const cache = new Map<string, Promise<ConfiguredGlbExport>>();
const maximumRecipeLength = 8192;

async function serve(
  request: Request,
  context: { params: Promise<{ assetKey: string }> },
) {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.ENABLE_V8_PREVIEW !== "1"
  )
    return new Response("Development preview is disabled.", { status: 404 });
  try {
    const { assetKey } = await context.params;
    const encoded = new URL(request.url).searchParams.get("recipe");
    if (!encoded || encoded.length > maximumRecipeLength)
      return Response.json(
        { message: "模型配置缺失或过长。" },
        { status: 400 },
      );
    const recipe = parsePreviewModelRecipe(JSON.parse(encoded));
    if (assetKey !== recipe.assetKey)
      return Response.json(
        { message: "模型地址与冻结来源不一致。" },
        { status: 400 },
      );
    // Asset names have already passed an explicit allowlist; no user filesystem paths.
    const sourcePath = path.join(
      process.cwd(),
      "public",
      "v8-assets",
      `${recipe.assetKey}.glb`,
    );
    const sourceInfo = await stat(sourcePath);
    const key = createHash("sha256")
      .update(JSON.stringify(recipe))
      .update(String(sourceInfo.mtimeMs))
      .update(String(sourceInfo.size))
      .digest("hex");
    let pending = cache.get(key);
    if (!pending) {
      pending = readFile(sourcePath).then((source) =>
        exportConfiguredGlb(
          source.buffer.slice(
            source.byteOffset,
            source.byteOffset + source.byteLength,
          ) as ArrayBuffer,
          recipe,
        ),
      );
      cache.set(key, pending);
      if (cache.size > 8) cache.delete(cache.keys().next().value!);
    }
    let exported: ConfiguredGlbExport;
    try {
      exported = await pending;
    } catch (error) {
      cache.delete(key);
      throw error;
    }
    const headers = new Headers({
      "Content-Type": "model/gltf-binary",
      "Content-Length": String(exported.byteLength),
      "Cache-Control": "private, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
      "X-V8-Sha256": exported.sha256,
      "X-V8-Source-Sha256": exported.sourceSha256,
      "X-V8-Execution": "local-configured-preview",
      ETag: `"${exported.sha256}"`,
    });
    if (request.headers.get("if-none-match") === headers.get("etag")) {
      headers.delete("content-length");
      return new Response(null, { status: 304, headers });
    }
    return new Response(request.method === "HEAD" ? null : exported.buffer, {
      headers,
    });
  } catch (error) {
    return Response.json(
      {
        message: error instanceof Error ? error.message : "模型配置导出失败。",
      },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const GET = serve;
export const HEAD = serve;
