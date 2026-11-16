import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
const require=createRequire(import.meta.url),jiti=require("jiti")(fileURLToPath(import.meta.url));
const {proxy}=jiti("../proxy.ts"),{NextRequest}=require("next/server");
const before={node:process.env.NODE_ENV,preview:process.env.ENABLE_V8_PREVIEW};const checks=[];
try {
 for(const [node,preview] of [["development","1"],["development","0"],["production","1"]]) {
  process.env.NODE_ENV=node;process.env.ENABLE_V8_PREVIEW=preview;
  for(const path of ["/login","/login?next=%2Fprojects","/v8","/v8-assets/catalog/inspection-reference.png"]) {
   const result=proxy(new NextRequest("http://localhost:3108"+path));
   const enabled=node==="development"&&preview==="1",login=path.startsWith("/login"),redirect=enabled&&path==="/login";
   assert.equal(result.status,redirect?307:login||enabled?200:404);
   if(redirect)assert.equal(result.headers.get("location"),"http://localhost:3108/v8/login");
   else assert.equal(result.headers.get("location"),null);
   checks.push({node,preview,path,status:result.status});
  }
 }
}finally{for(const [key,value]of[["NODE_ENV",before.node],["ENABLE_V8_PREVIEW",before.preview]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
await mkdir("test-results/v8-preview-entry",{recursive:true});await writeFile("test-results/v8-preview-entry/report.json",JSON.stringify({checks,passed:checks.length},null,2));console.log("PASS",checks.length,"preview entry and production authentication boundary checks");
