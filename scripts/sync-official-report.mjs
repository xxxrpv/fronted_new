import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "../../../../网站设计/EmbodiX官网-交付版/dist");
const target = resolve(here, "../lib/v8/official");
await mkdir(target, { recursive: true });
const sources = [];
async function read(name) {
  const text = await readFile(resolve(source, name), "utf8");
  sources.push({
    file: name,
    sha256: createHash("sha256").update(text).digest("hex"),
  });
  return text.replaceAll("\r\n", "\n");
}
const styles = [];
for (const name of [
  "styles.css",
  "site.css",
  "solution.css",
  "solution-business.css",
  "solution-scenarios.css",
  "i18n.css",
])
  styles.push(await read(name));
await writeFile(
  resolve(target, "style.ts"),
  `/** Original website CSS, unchanged. Isolated inside the report document. */\nexport const OFFICIAL_REPORT_STYLE = ${JSON.stringify(styles.join("\n"))};\n`,
);

let runtime = `/* eslint-disable -- Vendored user-supplied website; reviewed adapters live in the generator. */
/* Generated from the user-supplied EmbodiX website. Do not hand-edit. */
export function installOfficialRuntime(document, options = {}) {
  const observers = [], frames = new Set();
  const window = { parent: null, addEventListener() {}, EmboSolutionVisuals: options.visuals || {} };
  window.parent = window;
  const localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const requestAnimationFrame = callback => { const id = globalThis.requestAnimationFrame(time => {frames.delete(id);callback(time);});frames.add(id);return id; };
  const cancelAnimationFrame = id => {frames.delete(id);globalThis.cancelAnimationFrame(id);};
  const ResizeObserver = class extends globalThis.ResizeObserver { constructor(callback) {super(callback);observers.push(this);} };
  const MutationObserver = class extends globalThis.MutationObserver { constructor(callback) {super(callback);observers.push(this);} };
`;
runtime += await read("solution-data.js");
runtime += "\noptions.adaptSolutions?.(window.EmboSolutions);\n";
let scenarios = await read("solution-scenarios.js");
scenarios = scenarios.replace(
  "window.EmboScenarios=projects;",
  "options.adaptScenarios?.(projects, overviewCards, engineeringCards, integrationRows);\n  window.EmboScenarios=projects;",
);
runtime += scenarios;
let business = await read("solution-business.js");
business = business.replace(
  "window.EmboBusiness = freeze(data);",
  "options.adaptBusiness?.(data);\n  window.EmboBusiness = freeze(data);",
);
runtime += business;
let ui = await read("solution-business-ui.js");
ui = ui.replace(
  "root.dispatchEvent(new CustomEvent('embodix:business-calculated'",
  "options.onBusinessRefresh?.(root,current,state());\n      root.dispatchEvent(new CustomEvent('embodix:business-calculated'",
);
ui = ui.replace(
  "function download(kind){",
  "function download(kind){\n      if(options.onExport){options.onExport(kind,snapshot(),root);return;}",
);
ui = ui.replace(
  "if(input&&Number.isFinite(input.valueAsNumber)){",
  "if(input){",
);
ui = ui.replace(
  "state()[key]=input.valueAsNumber;",
  "state()[key]=Number.isFinite(input.valueAsNumber)&&input.validity.valid?input.valueAsNumber:null;",
);
ui = ui.replace(
  "if(input&&current&&Number.isFinite(current.inputs[input.dataset.businessField]))",
  "if(input&&current&&state()[input.dataset.businessField]!==null&&Number.isFinite(current.inputs[input.dataset.businessField]))",
);
ui = ui.replace(
  "data-business-reset>恢复当前场景默认值 ↺",
  "data-business-reset>重置测算 ↺",
);
runtime += ui;
let solution = await read("solution.js");
solution = solution.replace(
  "const ids = ['quadruped','humanoid','arm','aerial','mobile'];",
  "const ids = options.projectIds || ['quadruped','humanoid','arm','aerial','mobile'];",
);
solution = solution.replace(
  "let projectId = 'quadruped', expanded = false;",
  "let projectId = ids[0], expanded = false;",
);
// Do not pull the mobile chapter strip away while the user scrolls it.
solution = solution.replace(
  "const updateChapter=()=>{",
  "let lastActiveChapter='';\n    const updateChapter=()=>{",
);
solution = solution.replace(
  "revealChoice(nav,nav.querySelector('[aria-current=\"step\"]'));",
  "if(lastActiveChapter!==active){lastActiveChapter=active;revealChoice(nav,nav.querySelector('[aria-current=\"step\"]'));}",
);
runtime += solution;
runtime += await read("i18n.js");
runtime += `\nreturn { api: window, dispose() {observers.forEach(observer => observer.disconnect());frames.forEach(id => globalThis.cancelAnimationFrame(id));frames.clear();} };\n}\n`;
await writeFile(resolve(target, "runtime.js"), runtime);
await writeFile(
  resolve(target, "provenance.json"),
  JSON.stringify(
    {
      source: "网站设计/EmbodiX官网-交付版/dist",
      scope:
        "Seven-chapter solution reader only; project content and callbacks supplied by Embodex.",
      adaptations: [
        "Document-scoped runtime, no report-authored scripts",
        "Frozen project content adapter",
        "One actual project selector",
        "Missing numeric assumptions stay empty",
        "Parent-owned download callbacks",
        "Observer and animation-frame disposal",
      ],
      files: sources,
    },
    null,
    2,
  ),
);
console.log(
  `Synced ${sources.length} original files into the isolated report runtime.`,
);
