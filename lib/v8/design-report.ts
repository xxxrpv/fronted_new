import type {
  Approval,
  Artifact,
  AssetKey,
  ConceptBranch,
  ConceptRevision,
  Project,
  RequirementRevision,
  Template,
} from "./types";
import { TEMPLATE_CATALOG } from "./catalog";
import { reportModelMatches } from "./report-model-source";
import { OFFICIAL_SOLUTION_CSS } from "./report-official-style";
import {
  canDownload,
  runSourceValid,
  parameterSnapshotsEqual,
  V8Error,
} from "./state";

export interface DesignReportSource {
  artifactId?: string;
  templateId?: string;
  approvalId?: string;
  revisionId?: string;
  requirementId?: string;
  parameters?: Record<string, number>;
}
export interface DesignReportOptions {
  assetBaseUrl?: string;
  heroDataUrl?: string;
  createdAt?: string;
}
export interface DesignReportResult {
  html: string;
  fileName: string;
  mimeType: "text/html;charset=utf-8";
  sizeBytes: number;
  source: DesignReportSource & { assetKey: AssetKey; versionLabel: string };
}
export const REPORT_FORMAT = "embodex-design-report-v1";
export const REPORT_CHAPTERS = [
  ["overview", "需求与方案"],
  ["interactive", "交互式方案"],
  ["structure", "整体方案"],
  ["scenario", "场景任务"],
  ["budget", "投资预算"],
  ["economics", "企业效益"],
  ["delivery", "交付流程"],
] as const;

export const REPORT_PLANNING_FIELDS = [
  "quantity",
  "unitHardware",
  "software",
  "integration",
  "contingencyPct",
  "annualMaintenance",
  "annualEnergy",
  "annualOther",
  "annualReleasedHours",
  "hourlyCost",
  "cashRatePct",
  "otherAnnualSavings",
] as const;
export type ReportPlanningField = (typeof REPORT_PLANNING_FIELDS)[number];
export type ReportPlanningValues = Record<ReportPlanningField, string>;
export const emptyReportPlanning = (): ReportPlanningValues =>
  Object.fromEntries(
    REPORT_PLANNING_FIELDS.map((key) => [key, ""]),
  ) as ReportPlanningValues;

/** User assumptions only; absence never silently becomes a zero-valued quote. */
export function calculateReportPlanning(values: ReportPlanningValues) {
  const read = (key: ReportPlanningField) => {
    if (!values[key].trim()) return null;
    const number = Number(values[key]);
    if (!Number.isFinite(number) || number < 0 || number > 1e12) return null;
    if ((key === "cashRatePct" || key === "contingencyPct") && number > 100)
      return null;
    if (
      key === "quantity" &&
      (!Number.isInteger(number) || number < 1 || number > 100000)
    )
      return null;
    return number;
  };
  const n = Object.fromEntries(
    REPORT_PLANNING_FIELDS.map((key) => [key, read(key)]),
  ) as Record<ReportPlanningField, number | null>;
  const budgetReady = [
    n.quantity,
    n.unitHardware,
    n.software,
    n.integration,
    n.contingencyPct,
  ].every((x) => x !== null);
  const operatingReady = [
    n.annualMaintenance,
    n.annualEnergy,
    n.annualOther,
  ].every((x) => x !== null);
  const subtotal = budgetReady
    ? n.quantity! * n.unitHardware! + n.software! + n.integration!
    : null;
  const reserve =
    subtotal !== null ? (subtotal * n.contingencyPct!) / 100 : null;
  const total = subtotal !== null ? subtotal + reserve! : null;
  const annualOperating = operatingReady
    ? n.annualMaintenance! + n.annualEnergy! + n.annualOther!
    : null;
  const economyReady =
    operatingReady &&
    [
      n.annualReleasedHours,
      n.hourlyCost,
      n.cashRatePct,
      n.otherAnnualSavings,
    ].every((x) => x !== null);
  const laborValue = economyReady
    ? n.annualReleasedHours! * n.hourlyCost!
    : null;
  const laborCash =
    laborValue !== null ? (laborValue * n.cashRatePct!) / 100 : null;
  const netCash =
    laborCash !== null
      ? laborCash + n.otherAnnualSavings! - annualOperating!
      : null;
  return {
    subtotal,
    reserve,
    total,
    annualOperating,
    laborValue,
    laborCash,
    netCash,
    payback:
      total !== null && total > 0 && netCash !== null && netCash > 0
        ? total / netCash
        : null,
    threeYearNet:
      total !== null && netCash !== null ? netCash * 3 - total : null,
    threeYearCost:
      total !== null && annualOperating !== null
        ? total + annualOperating * 3
        : null,
    budgetReady,
    operatingReady,
    economyReady,
  };
}

export const REPORT_PLANNING_CSS = `
.report-requirements{padding:40px 0 0}.report-requirements .section-head .number{display:none}.report-requirements .section-head{grid-template-columns:1fr}.report-interactive-fallback{padding:24px;border:1px solid #dde3e9;border-radius:18px;background:#f5f6f8;text-align:center}.report-interactive-fallback img{width:min(560px,100%);height:300px;object-fit:contain;display:block;margin:auto}.report-interactive-fallback p{font-size:12px}.report-interactive-host:empty{display:none}.report-live-ready+.report-interactive-fallback{display:none}.report-planning{font:13px/1.8 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:#5a5d5c}.report-planning-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px;margin-top:20px}.report-planning label{display:flex;flex-direction:column;gap:8px;font-size:12px;min-width:0;color:#707573}.report-planning input{width:100%;min-width:0;min-height:42px;padding:10px 12px;border:1px solid #d5d6d6;border-radius:9px;background:#fff;color:#4e5150;font:14px/1.5 inherit;outline:none}.report-planning input:focus-visible{outline:3px solid #a7aaa9;outline-offset:2px}.report-planning input::placeholder{color:#959998}.report-planning-actions{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:20px}.report-planning-actions p{font-size:12px}.report-planning button{padding:8px 14px;border:1px solid #d5d6d6;border-radius:9px;background:#f8f8f8;color:#6b6f6e;font:12px/1.6 inherit;cursor:pointer}.report-planning button:focus-visible{outline:3px solid #a7aaa9;outline-offset:3px}.report-planning-results{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-top:24px}.report-planning-results article{border:1px solid #dde3e9;border-radius:13px;padding:18px 20px;background: #ffffffb8}.report-planning-results span{display:block;font-size:11px;color:#8a8f8d}.report-planning-results strong{display:block;margin-top:8px;font-size:23px;font-weight:550;color:#5d6160;overflow-wrap:anywhere}.report-planning-results small{display:block;font-size:11px;color:#8a8f8d;margin-top:5px}.report-formula{font-size:12px;color:#828785;line-height:1.9;margin-top:18px}.report-planning-static{padding:22px;border:1px solid #e2e3e5;border-radius:14px;background:#f5f6f8}.report-planning-static p{font-size:13px}.report-planning-host:not(:empty)+.report-planning-static{display:none}.report-task-details{margin-top:22px}.report-task-details details{padding:18px 21px;border:1px solid #e2e3e5;border-radius:12px;background:#f7f8fa;margin-top:12px}.report-task-details summary{font-size:14px;font-weight:550;color:#696d6c;cursor:pointer}.report-task-details details p{font-size:13px;line-height:1.9;margin-top:12px}.report-reading-note{font-size:11px;color:#888d8b;padding:10px 0}.report-planning-reading dt{color:#8d9190;font-size:12px}.report-planning-reading dd{margin:4px 0 15px;color:#616564;font-size:14px}
@media(max-width:1000px){.report-planning-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.report-planning-results{grid-template-columns:repeat(2,minmax(0,1fr))}}
.report-print-value{display:none}
@media(max-width:520px){.report-planning-grid{gap:14px}.report-planning-results{grid-template-columns:1fr}.report-planning-results strong{font-size:21px}.report-planning-actions{align-items:flex-start}.report-interactive-fallback{padding:15px}.report-interactive-fallback img{height:220px}}
@media print{.report-planning-actions,.report-planning input{display:none}.report-print-value{display:block;font-size:13px;color:#494c4b}.report-planning-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.report-planning-results{grid-template-columns:repeat(3,minmax(0,1fr))}.report-planning-results strong{font-size:16px}.report-interactive-fallback{display:block!important}.report-interactive-host{display:none!important}}
`;
/** Presentation only. The approved text and artifact bytes remain unchanged. */
export const DESIGN_REPORT_OVERVIEW_CSS = `
@media screen{
html{scroll-padding-top:62px}.section{scroll-margin-top:0}
body{background:#fbfcfc}.report-header{padding:17px max(30px,calc((100% - 1160px)/2));min-height:68px;background:#fbfbfbe6;backdrop-filter:blur(24px) saturate(115%);box-shadow:inset 0 1px 0 #ffffffdb}.brand{font-size:24px;letter-spacing:-.9px;font-weight:650}.brand small{font-size:12px;letter-spacing:0;color:#878b8a;font-weight:450}.report-projects{display:flex;align-items:center;justify-content:space-between;gap:20px;min-height:70px;padding:16px max(30px,calc((100% - 1160px)/2));border-bottom:1px solid #e2e7ec;background: #ffffffb8}.report-projects .project-chip{display:flex;align-items:center;gap:10px;max-width:100%;padding:9px 16px;border:1px solid #d2d4d3;border-radius:11px;color:#5d605f;background: #ffffffb8;box-shadow:inset 0 1px 0 #fff;font-size:12px;overflow-wrap:anywhere}.project-chip:before{content:"";width:6px;height:6px;flex:none;border-radius:50%;background:#989b9a;box-shadow:0 0 0 4px #e7ecf0}.project-context-note{font-size:11px;color:#888d8b}.chapters{gap:14px;justify-content:center;padding:11px 24px;background:#fbfbfbe6;backdrop-filter:blur(24px) saturate(115%);box-shadow:inset 0 1px 0 #ffffffdb}.chapters a{min-height:35px;padding:6px 13px;border:1px solid transparent;border-radius:9px;font-size:12px;line-height:1.7;flex-shrink:0;transition:background .18s,border-color .18s,color .18s}.chapters a:hover{color:#5c5f5e;background:#f2f4f7}.chapters a[aria-current=step]{border-color:#d2d4d3;background: #ffffffb8;color:#5c5f5e;box-shadow:inset 0 1px 0 #ffffffed,0 2px 7px #787d7b0a}.chapters i{color:#909593;font-size:9px;letter-spacing:1px}.report-main{width:min(1160px,calc(100% - 104px))}.hero{grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:32px;min-height:440px;padding:46px 0 33px}.kicker{font-size:10px;letter-spacing:2px;margin-bottom:16px}.eyebrow{font-size:12px;letter-spacing:.6px;margin-bottom:17px}.hero h1{font-size:clamp(33px,3.55vw,50px);line-height:1.38;letter-spacing:-1.4px;text-wrap:balance;max-width:670px;font-weight:650}.hero h1 span{font-size:.46em;line-height:1.55;letter-spacing:0;margin-top:14px;color:#848987}.hero-summary{font-size:14px;line-height:1.95;margin-top:22px;max-width:570px}.hero-art{height:370px}.hero-art img{height:96%;width:106%;max-width:106%;object-fit:contain;filter:drop-shadow(0 17px 18px #696d6c18);border-radius:0}.hero-art figcaption{bottom:-3px;font-size:10px;letter-spacing:.3px;color:#898e8c}.hero-art:before{inset:8% -3%;background: #ffffffb8}.hero-art .orbit{left:10%;right:10%;height:35%;bottom:6%;border-color:#dadcde70}.hero-workbench{display:inline-flex;align-items:center;justify-content:space-between;gap:30px;min-height:44px;margin-top:26px;padding:11px 18px;border:1px solid #cfd2d4;border-top-color:#fff;border-radius:12px;background: #ffffffb8;box-shadow:inset 0 1px 0 #fff,0 7px 20px #8085830d;color:#646766;font:550 12px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;cursor:pointer}.hero-workbench:hover{background: #ffffffb8;border-color:#b6babe}.hero-workbench:focus-visible{outline:3px solid #a7aaa9;outline-offset:4px}.hero-workbench span{font-size:17px;font-weight:400}.hero-facts{padding:27px 30px;border-radius:18px;background: #ffffffb8;border-color:#dde3e9;box-shadow:inset 0 1px 0 #fff}.hero-facts dd{font-size:18px}.section{padding:53px 0 47px}.section-head{margin-bottom:30px}.section h2{font-size:30px;letter-spacing:-.7px}.number{font-size:55px;font-weight:300;color:#b6b8b8}.card{padding:27px}.card h3{font-size:17px}.card p,.check-list{font-size:13px}.note{background:#f4f4f5;color:#797d7c}.report-reader .report-header,.report-reader .report-projects{display:none}
@media(max-width:1100px){.report-main{width:calc(100% - 64px)}.hero{gap:22px;min-height:390px;padding-top:35px}.hero h1{font-size:38px}.hero-art{height:315px}.chapters{gap:7px}.chapters a{padding-inline:10px}.hero-facts{padding:24px}.hero-facts dd{font-size:16px}}
@media(max-width:760px){.report-header{padding:15px 20px}.brand{font-size:22px}.report-projects{padding:14px 20px;min-height:62px}.project-context-note{display:none}.chapters{justify-content:flex-start;gap:9px;padding:10px 18px;scrollbar-width:none;scroll-padding-inline:18px}.chapters::-webkit-scrollbar{display:none}.chapters a{font-size:11px;min-height:34px;padding-inline:9px}.report-main{width:calc(100% - 42px)}.hero{grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);gap:17px;min-height:350px;padding:32px 0 28px}.hero h1{font-size:31px;letter-spacing:-.9px}.hero h1 span{font-size:.49em}.hero-summary{font-size:12px;margin-top:16px}.hero-art{height:265px}.hero-art img{width:100%;max-width:100%}.hero-art figcaption{font-size:9px;line-height:1.7}.hero-workbench{font-size:11px;gap:20px;min-height:42px;padding:10px 14px;margin-top:21px}.hero-facts{padding:22px 19px}.hero-facts dd{font-size:14px}.section{padding:39px 0 34px}.section h2{font-size:25px}.card{padding:23px}.number{font-size:44px}}
@media(max-width:520px){.brand small{font-size:11px;margin-left:12px;padding-left:12px}.report-projects .project-chip{font-size:11px;padding:8px 12px}.report-main{width:calc(100% - 38px)}.hero{grid-template-columns:1fr;gap:0;padding-top:29px}.hero h1{font-size:32px;max-width:100%}.hero h1 span{font-size:.48em;margin-top:12px}.hero-summary{font-size:13px;line-height:1.9;margin-top:17px}.hero-art{height:245px;margin-top:20px}.hero-art img{width:95%;height:100%}.hero-art figcaption{bottom:-2px}.hero-workbench{font-size:12px;gap:28px}.hero-facts{gap:10px;padding:20px 15px}.hero-facts div+div{padding-left:12px}.hero-facts dt{font-size:10px}.hero-facts dd{font-size:13px;line-height:1.6}.section h2{font-size:24px}.card p{font-size:13px}.source-row{font-size:12px}.report-tag{display:none}}
@media(prefers-reduced-motion:reduce){.chapters a{transition:none}}
@media(prefers-reduced-transparency:reduce),(prefers-contrast:more){.report-header,.report-projects,.chapters{background:#fbfcfc;backdrop-filter:none;-webkit-backdrop-filter:none}.hero-facts,.hero-workbench{background:#f2f4f7;box-shadow:none}.chapters a[aria-current=step]{background:#ebeef2;border-color:#abaead}.hero-summary,.project-context-note,.hero-art figcaption{color:#5c605f}}
}
@media print{.report-projects,.hero-workbench{display:none!important}}
`;

export const DESIGN_REPORT_SILVER_CSS = `
@media screen{
:root{--ink:#30373e;--muted:#657483;--line:#dbe2e8;--blue:#596673}
body{color:var(--ink);background: #ffffffb8}
.report-header,.report-projects,.chapters{background: #ffffffb8;border-color:#dae0e7;backdrop-filter:blur(24px) saturate(1.05)}
.brand,.hero h1,.section h2,.card h3{color:#30373e}.hero-summary,.brief-text{color:#647281}
.glass,.hero-facts{background: #ffffffb8;border-color:#ffffffed;box-shadow:inset 0 1px 0 #fff,0 6px 20px #272d330b,0 0 0 1px #5c697710}
.hero-workbench,.chapters a[aria-current=step]{background: #ffffffb8;border-color:#fff;color:#4a545f;box-shadow:inset 0 1px 0 #fff,0 3px 10px #2d343b0b,0 0 0 1px #6878881a}
.hero-art:before{background: #ffffffb8}
.note,.pill,.architecture article,.description,.validation-status{background:#f5f6f8;border-color:#dae1e8;color:#637180}.card p,.check-list,.source-row dd,td{color:#627180}th{background:#f0f3f6;color:#637281}
a:focus-visible,button:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid #8997a5;outline-offset:3px}
}
`;

/** Website's exact component styling, with only safe document-shell adapters. */
export const DESIGN_REPORT_WEBSITE_CSS = `${OFFICIAL_SOLUTION_CSS}
body{--solution-ink:#3b444d;--solution-glass: #ffffffb8;--solution-glass-shadow:inset 1px 1px 0 #ffffffed,inset -1px -1px 0 #c5ccd347,0 12px 32px #57637013,0 2px 5px #63718008;background: #ffffffb8;color:#3b444d}
:root{--ink:#3b444d;--muted:#687786;--line:#dae0e7;--blue:#5f6e7c}
.report-main{width:min(1160px,calc(100% - 104px))}.chapters{background:#fafbfce6;border-color:#dce2e8;gap:23px;padding:9px 24px}.chapters a{color:#616f7d;padding:7px 10px;border-radius:9px;border:1px solid transparent;min-height:38px}.chapters a[aria-current=step]{border-color:#cdd3d9;background: #ffffffb8;color:#515e6a;box-shadow:inset 0 1px 0 #ffffffed,0 2px 7px #6b7a8a0a}.chapters i{color:#7e8d9c}
.hero.solution-hero{min-height:380px;padding:38px 0 26px}.hero.solution-hero h1{font-size:clamp(31px,3.25vw,47px);line-height:1.4;letter-spacing:-1.5px;font-weight:650;color:#343c44}.hero h1 span{display:none}.hero-art.solution-hero-art{height:330px}.hero-art.solution-hero-art img{width:100%;max-width:100%;height:95%;mix-blend-mode:multiply}.hero-art figcaption{font-size:9px;color:#7a8a99}.hero-workbench{border-color:#c5ccd3;background: #ffffffb8;color:#56626f;box-shadow:inset 1px 1px 0 #fff,inset -1px -1px 0 #c1c8cf4d,0 7px 19px #66758414}
.report-overview-brief .solution-metrics dd{font-size:21px;font-weight:500;letter-spacing:-.5px}.report-overview-brief .solution-metrics dd.is-text{font-size:15px;line-height:1.6}.report-overview-brief .solution-metrics div{padding-left:18px}.report-overview-brief .solution-metrics dt{font-size:10px}.report-requirements{padding-top:20px}.report-requirements>.section-head{display:none!important}.report-requirements>details>summary{cursor:pointer;list-style:none}.report-requirements>details>summary:after{content:'＋';float:right;color:#a0abb6}.report-requirements>details[open]>summary:after{content:'−'}
.section.solution-section{padding:54px 0 48px;border-color:#dae0e7}.section-head.solution-numbered-heading{grid-template-columns:76px minmax(0,1fr);gap:23px}.section-head .number{font-size:62px;color:#b0bac3;letter-spacing:-5px}.section-head h2{font-size:29px;color:#434d57;font-weight:650}.section-head .kicker{font-size:9px;letter-spacing:2px;color:#9aa6b1}.section-head p:last-child{font-size:12px;color:#8794a2}.glass,.card,.note,.pill,.architecture article{border-color:#d4dce4;background:var(--solution-glass);box-shadow:var(--solution-glass-shadow)}.card h3,.source-row dd,.brief-text{color:#505c68}.card p,.check-list,.note{color:#687786}.card .mini-label,.source-row dt{color:#738393}.three-col.solution-cards{margin-top:24px}.three-col.solution-cards .card{padding:24px}.three-col.solution-cards h3{font-size:16px;font-weight:550}.three-col.solution-cards p{font-size:12px;line-height:1.9}.table-wrap{border-color:#dce2e8}th{color:#7d8c9b;background:#f3f6f8}td{color:#616f7d;border-color:#e5eaef}.source-row{border-color:#e1e6ec}.description{background:#f2f4f7c9;color:#647383;border-color:#cbd1d7}.footer{color:#8c9aa7}.report-planning button{color:#5d6b79;border-color:#d1dae2;background: #ffffffb8}
.report-system-cards{grid-template-columns:repeat(3,minmax(0,1fr))}.report-system-cards .system-illustrated-card{border-color:#d4dce4;background:var(--solution-glass);box-shadow:var(--solution-glass-shadow)}.report-system-cards .system-illustrated-card>.system-card-art{position:relative;aspect-ratio:2/1;height:auto;min-height:0;padding:0}.report-system-cards .system-generated-visual img{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:cover}.report-system-cards .system-card-copy{padding:24px}.report-system-cards .system-card-action{border:0;border-top:1px solid #dae0e7;background:transparent;width:100%;padding:15px 0 0;margin-top:20px;text-align:left;color:#5f6e7c;cursor:pointer}.report-system-cards .system-card-copy p{font-size:12px;color:#687786;line-height:1.9}@media(max-width:760px){.report-system-cards{grid-template-columns:1fr}.report-system-cards .system-illustrated-card>.system-card-art{height:auto}}.report-system-cards>button{text-align:left;padding:24px;border:1px solid #d4dce4;background:var(--solution-glass);box-shadow:var(--solution-glass-shadow);cursor:pointer;color:#687786;font:inherit}.report-system-cards>button[aria-pressed=true]{border-color:#bcc4cc;background: #ffffffb8}.report-system-cards h4{font-size:19px;color:#505c68;margin-bottom:12px}.report-system-cards p{font-size:12px;line-height:1.9;margin:8px 0}.report-system-action{display:block;margin-top:22px;color:#5f6e7c;font-size:12px}.report-delivery-folds .business-detail>summary{padding:20px 23px}.report-delivery-folds .business-detail-body{padding:23px}.report-detail-original>.note{box-shadow:none}.report-detail-original{padding:22px}.report-delivery-actions{display:flex;gap:10px;flex-wrap:wrap}.report-delivery-actions button{border:1px solid #c5ccd3;border-radius:10px;padding:11px 17px;color:#5f6e7c;background: #ffffffb8;cursor:pointer;font:inherit}@media screen{.report-print-value{display:none!important}}.report-planning-results.business-outcomes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0;margin:0}.report-planning-results.business-outcomes article{background:transparent;border:0;box-shadow:none;padding:20px 18px;border-radius:0}.report-planning .business-outcomes strong{font-size:26px}.business-budget-keyfigures .business-outcomes{grid-template-columns:1fr}.business-budget-keyfigures .business-outcomes article+article{border-top:1px solid #e1e6ec}.report-overview-brief .solution-metrics dd.is-text{font-size:15px}.report-return-top{display:block;text-align:right;margin-top:30px;color:#6d7e8e;font-size:12px}
@media(max-width:1100px){.report-main{width:calc(100% - 64px)}.chapters{justify-content:flex-start;gap:16px}}
@media(max-width:760px){.report-main{width:calc(100% - 38px)}.hero.solution-hero{min-height:0;grid-template-columns:1fr .8fr;padding-top:31px;gap:16px}.hero.solution-hero h1{font-size:29px;letter-spacing:-.8px}.hero-art.solution-hero-art{height:245px}.section.solution-section{padding:38px 0 32px}.section-head.solution-numbered-heading{grid-template-columns:51px minmax(0,1fr);gap:17px}.section-head .number{font-size:46px}.section-head h2{font-size:25px}.report-overview-brief .solution-metrics dd{font-size:19px}}
@media(max-width:520px){.hero.solution-hero{grid-template-columns:1fr;gap:0}.hero.solution-hero h1{font-size:31px}.hero-art.solution-hero-art{height:220px;margin-top:18px}.hero-art.solution-hero-art img{width:87%}.report-overview-brief .solution-metrics div{border-left:0;padding-left:0}.report-overview-brief .solution-metrics dd{font-size:22px}.report-overview-brief .solution-metrics dd.is-text{font-size:15px}.section-head.solution-numbered-heading{grid-template-columns:43px minmax(0,1fr);gap:14px}.section-head .number{font-size:39px}.section-head h2{font-size:24px}}
@media print{.report-requirements details{display:block}.report-overview-brief{break-inside:avoid}.report-delivery-actions,.report-return-top{display:none}}
`;

/** Add a controlled reading skin only; never resolve current project facts. */
export function createDesignReportPreviewHtml(html: string): string {
  if (!html.includes(`content="${REPORT_FORMAT}"`) || !/<\/head>/i.test(html))
    throw new V8Error(
      "REPORT_FORMAT_INVALID",
      "不是受支持的 Embodex 方案格式。",
    );
  const presentation = html
    .replaceAll(
      'src="/v8-assets/inspection-reference.png"',
      'src="/v8-assets/official-inspection-hero.png"',
    )
    .replaceAll(
      'src="/v8-assets/mobile-reference.png"',
      'src="/v8-assets/official-mobile-hero.png"',
    );
  return presentation.replace(
    /<\/head>/i,
    `<style data-report-presentation="overview-v2">${DESIGN_REPORT_OVERVIEW_CSS}\n${REPORT_PLANNING_CSS}\n${DESIGN_REPORT_WEBSITE_CSS}\n@media screen{body>.report-header,body>.report-projects{display:none}}</style></head>`,
  );
}
const IMAGES: Record<AssetKey, string> = {
  "go2-high-fidelity": "/v8-assets/go2-high-fidelity.png",
  compact: "/v8-assets/compact.svg",
  quadruped: "/v8-assets/quadruped.svg",
  tripod: "/v8-assets/tripod.svg",
  conveyor: "/v8-assets/conveyor.svg",
  "inspection-reference": "/v8-assets/official-inspection-hero.png",
  "mobile-reference": "/v8-assets/official-mobile-hero.png",
};
const escape = (value: unknown): string =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
const text = (value: unknown, fallback = "尚未提供") =>
  escape(
    value === undefined || value === null || value === "" ? fallback : value,
  );
const version = (value: number) => `V${String(value).padStart(2, "0")}`;
const bytes = (value: number) =>
  value < 1024
    ? `${value} B`
    : value < 1048576
      ? `${(value / 1024).toFixed(1)} KB`
      : `${(value / 1048576).toFixed(2)} MB`;
const filename = (value: string) =>
  value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .slice(0, 64)
    .trim() || "design";
function assetUrl(path: string, base?: string): string {
  if (!base) return path;
  const url = new URL(base);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new V8Error("REPORT_ASSET_ORIGIN", "方案图像来源地址无效。");
  return new URL(path, url.origin).href;
}
interface Resolved {
  selector: DesignReportSource;
  template?: Template;
  approval?: Approval;
  branch?: ConceptBranch;
  revision?: ConceptRevision;
  requirement: RequirementRevision;
  assetKey: AssetKey;
  title: string;
  versionLabel: string;
  parameters: Record<string, number>;
}
function resolveSource(project: Project, input: DesignReportSource): Resolved {
  if (project.source !== "preview")
    throw new V8Error(
      "REPORT_CONTRACT_UNAVAILABLE",
      "真实项目的方案来源与交付契约尚未验证，暂不能生成交付文档。",
    );
  const artifact = input.artifactId
    ? project.artifacts.find((item) => item.id === input.artifactId)
    : undefined;
  if (
    input.artifactId &&
    (!artifact || artifact.projectId !== project.id || !artifact.authorized)
  )
    throw new V8Error(
      "REPORT_SOURCE_MISMATCH",
      "方案文件不属于当前项目，或没有访问权限。",
    );
  const extra = artifact as
    | (Artifact & {
        requirementId?: string;
        parameterSnapshot?: Record<string, number>;
      })
    | undefined;
  const selector: DesignReportSource = {
    ...input,
    templateId: input.templateId || artifact?.templateId,
    approvalId: input.approvalId || artifact?.approvalId,
    revisionId: input.revisionId || artifact?.revisionId,
    requirementId: input.requirementId || extra?.requirementId,
    parameters: input.parameters || extra?.parameterSnapshot,
  };
  if (
    artifact &&
    ((input.templateId && input.templateId !== artifact.templateId) ||
      (input.approvalId && input.approvalId !== artifact.approvalId) ||
      (input.revisionId && input.revisionId !== artifact.revisionId))
  )
    throw new V8Error(
      "REPORT_SOURCE_MISMATCH",
      "指定的方案来源与文件记录不一致。",
    );
  if (
    extra &&
    input.requirementId &&
    extra.requirementId &&
    input.requirementId !== extra.requirementId
  )
    throw new V8Error(
      "REPORT_SOURCE_MISMATCH",
      "指定的需求版本与文件快照不一致。",
    );
  if (artifact?.templateId && (!selector.requirementId || !selector.parameters))
    throw new V8Error(
      "REPORT_SNAPSHOT_MISSING",
      "旧模板文件缺少固定的需求或参数快照，请查看原文件，不能用当前数据替代。",
    );
  if (!selector.approvalId && !selector.templateId)
    selector.approvalId = project.approvals.at(-1)?.id;
  if (!selector.approvalId && !selector.templateId)
    selector.templateId = project.templateId;
  if (selector.approvalId && selector.templateId)
    throw new V8Error(
      "REPORT_SOURCE_MISMATCH",
      "一个方案快照不能同时代表模板和另一份概念批准。",
    );
  if (selector.approvalId) {
    const approval = project.approvals.find(
      (item) => item.id === selector.approvalId,
    );
    const branch = project.branches.find(
      (item) => item.id === approval?.branchId,
    );
    const revision = branch?.revisions.find(
      (item) => item.id === approval?.revisionId,
    );
    if (
      !approval ||
      approval.projectId !== project.id ||
      !branch ||
      branch.projectId !== project.id ||
      !revision ||
      revision.branchId !== branch.id ||
      revision.descriptionId !== approval.descriptionId ||
      revision.description !== approval.description ||
      (selector.revisionId && selector.revisionId !== revision.id) ||
      (selector.requirementId &&
        selector.requirementId !== revision.requirementId) ||
      (selector.parameters &&
        !parameterSnapshotsEqual(
          selector.parameters,
          approval.parameterSnapshot || revision.parameterSnapshot,
        ))
    )
      throw new V8Error(
        "REPORT_SOURCE_MISMATCH",
        "批准、版本与描述来源不一致，已阻止生成方案。",
      );
    const requirement = project.requirements.find(
      (item) =>
        item.id === revision.requirementId && item.projectId === project.id,
    );
    if (!requirement)
      throw new V8Error(
        "REPORT_REQUIREMENT_MISSING",
        "找不到这个版本引用的需求，不能使用最新需求替代。",
      );
    return {
      selector: {
        ...selector,
        revisionId: revision.id,
        requirementId: requirement.id,
      },
      approval,
      branch,
      revision,
      requirement,
      assetKey: revision.assetKey,
      title: branch.name,
      versionLabel: version(revision.sequence),
      parameters: {
        ...(approval.parameterSnapshot || revision.parameterSnapshot || {}),
      },
    };
  }
  if (selector.templateId) {
    const template = TEMPLATE_CATALOG.find(
      (item) => item.id === selector.templateId,
    );
    const saved =
      project.templateId === selector.templateId ||
      project.journey.some(
        (item) =>
          item.kind === "template" && item.refId === selector.templateId,
      );
    if (!template || !saved)
      throw new V8Error(
        "REPORT_TEMPLATE_UNSAVED",
        "请先保存模板适配，再导出对应方案。",
      );
    const requirement = selector.requirementId
      ? project.requirements.find((item) => item.id === selector.requirementId)
      : project.requirements.at(-1);
    if (!requirement || requirement.projectId !== project.id)
      throw new V8Error(
        "REPORT_REQUIREMENT_MISSING",
        "模板对应的需求版本不存在。",
      );
    const parameters = { ...(selector.parameters || project.parameters) };
    for (const [key, value] of Object.entries(parameters)) {
      const definition = template.parameters.find((item) => item.key === key);
      if (
        !definition ||
        !Number.isFinite(value) ||
        value < definition.min ||
        value > definition.max
      )
        throw new V8Error(
          "REPORT_PARAMETER_INVALID",
          "模板方案参数超出支持范围。",
        );
    }
    return {
      selector: { ...selector, requirementId: requirement.id, parameters },
      template,
      requirement,
      assetKey: template.assetKey,
      title: template.name,
      versionLabel: "模板适配快照",
      parameters,
    };
  }
  throw new V8Error(
    "REPORT_SOURCE_REQUIRED",
    "请先保存模板适配或确认一个具体概念版本。",
  );
}

/** Visual hierarchy adapted from the user-supplied complete official solution.
 * Source ownership and exact reference files: docs/ASSETS.md.
 * Main document text remains opaque and readable; only navigation uses glass.
 */
export const DESIGN_REPORT_CSS = `
:root{color-scheme:light;--ink:#3b3d3c;--muted:#787d7b;--line:#e0e6ec;--blue:#686b6a}*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:88px}body{margin:0;background:#f8fafb;color:var(--ink);font:14px/1.85 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}a{color:var(--blue);text-underline-offset:4px}a:focus-visible,summary:focus-visible{outline:3px solid #a7aaa9;outline-offset:4px}p,h1,h2,h3,h4,figure,dl,dd{margin:0}p{color:var(--muted)}.report-header{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:19px max(28px,calc((100% - 1120px)/2));border-bottom:1px solid #dde3e9;background:#fcfcfcf0;backdrop-filter:blur(18px)}.brand{font-size:23px;font-weight:720;letter-spacing:-.8px;color:#3f4241}.brand small{font-size:11px;font-weight:500;letter-spacing:.7px;margin-left:15px;padding-left:15px;border-left:1px solid #dadcde;color:#898d8c}.report-tag{font-size:11px;color:#7e8281;border:1px solid #dce2e8;background:#f6f8f9;border-radius:99px;padding:5px 12px}.chapters{position:sticky;top:0;z-index:5;display:flex;justify-content:center;gap:30px;padding:13px 24px;background:#fbfcfcf2;backdrop-filter:blur(18px);border-bottom:1px solid #e0e6ec;overflow-x:auto;white-space:nowrap}.chapters a{display:flex;gap:8px;align-items:center;text-decoration:none;font-size:12px;color:#707473}.chapters i{font-style:normal;font-size:10px;color:#a7abaa}.report-main{width:min(1120px,calc(100% - 72px));margin:auto}.hero{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:40px;align-items:center;min-height:400px;padding:54px 0 40px}.kicker{font-size:10px;color:#979a99;letter-spacing:2px;margin-bottom:16px}.eyebrow{font-size:12px;color:#7e8381;margin-bottom:14px}.hero h1{font-size:clamp(31px,3.8vw,46px);font-weight:650;line-height:1.4;letter-spacing:-1.1px;overflow-wrap:anywhere}.hero h1 span{display:block;font-size:.56em;font-weight:500;letter-spacing:0;color:#808483;margin-top:12px}.hero-summary{font-size:14px;line-height:1.95;margin-top:22px;max-width:600px}.hero-art{height:330px;position:relative;display:grid;place-items:center;isolation:isolate;min-width:0}.hero-art:before{content:"";position:absolute;inset:10% -2%;background: #ffffffb8;border-radius:50%;z-index:-1}.hero-art img{width:100%;height:90%;object-fit:contain;filter:drop-shadow(0 14px 16px #64686716);border-radius:16px}.hero-art figcaption{position:absolute;bottom:0;left:0;right:0;text-align:center;font-size:11px;color:#8c918f}.hero-art .orbit{position:absolute;left:10%;right:10%;height:33%;bottom:8%;border:1px solid #dadcde90;transform:rotate(-10deg);border-radius:50%;z-index:-1}.hero-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;padding:25px 28px;border:1px solid #e2e3e5;border-top-color:#fff;border-radius:18px;background: #ffffffb8;box-shadow:inset 0 1px 0 #fff}.hero-facts div+div{border-left:1px solid #dde3e9;padding-left:23px}.hero-facts dt{font-size:11px;color:#8c908f}.hero-facts dd{font-size:18px;color:#616564;margin-top:5px;line-height:1.6}.section{padding:56px 0 50px;border-bottom:1px solid #e7e8e8;scroll-margin-top:16px}.section-head{display:grid;grid-template-columns:66px minmax(0,1fr);gap:22px;align-items:start;margin-bottom:27px}.number{font-size:56px;font-weight:300;line-height:1;letter-spacing:-4px;color:#b8bcc0}.section-head .kicker{margin:2px 0 8px}.section h2{font-size:29px;font-weight:650;line-height:1.4;letter-spacing:-.5px;color:#4e5251}.section-head p:last-child{font-size:13px;margin-top:8px;max-width:700px}.glass{background: #ffffffb8;border:1px solid #e3e5e6;border-top-color:#fff;border-radius:18px;box-shadow:0 8px 30px #74797708,inset 0 1px 0 #fff}.brief{padding:28px 30px}.mini-label{display:block;font-size:11px;letter-spacing:.5px;color:#8e9291;margin-bottom:10px}.prewrap{white-space:pre-wrap;overflow-wrap:anywhere}.brief-text{font-size:15px;line-height:1.95;color:#606463}.two-col{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin-top:20px}.three-col{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.card{padding:25px;min-width:0}.card h3{font-size:17px;font-weight:600;line-height:1.6;color:#5e6261;margin-bottom:10px}.card p{font-size:13px}.card .mini-label{margin-bottom:14px}.note{font-size:12px;line-height:1.9;color:#848887;padding:18px 21px;border:1px solid #dfe5eb;border-radius:12px;background:#f2f4f79e;margin-top:20px}.pill{display:inline-block;border:1px solid #dfe5eb;border-radius:99px;padding:3px 10px;font-size:11px;color:#767a79;background:#f7f7f7;margin:0 6px 6px 0}.architecture{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:13px;align-items:stretch;margin-top:25px}.architecture article{position:relative;padding:18px 14px;border-radius:13px;border:1px solid #dfe5eb;background:#fbfcfc;text-align:center}.architecture b{display:block;font-size:13px;color:#6c706f}.architecture small{display:block;font-size:11px;color:#929594;margin-top:5px}.architecture article:not(:last-child):after{content:"→";position:absolute;right:-12px;top:32%;color:#afb2b1;font-size:18px;z-index:1}.table-wrap{overflow:auto;margin-top:22px;border:1px solid #e4e5e7;border-radius:13px;background:#fff}table{width:100%;border-collapse:collapse;text-align:left;font-size:12px}th{padding:12px 17px;background:#f7f7f7;color:#7d8280;font-weight:550;white-space:nowrap}td{padding:14px 17px;border-top:1px solid #eaebeb;color:#6f7472;vertical-align:top;overflow-wrap:anywhere}td strong{font-weight:600;color:#626564}.task-list{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:24px}.task-list li{position:relative;border-top:1px solid #dbdddf;padding-top:20px;min-width:0}.task-list li:before{content:"";position:absolute;left:0;top:-4px;width:7px;height:7px;border:1px solid #b6b9b8;border-radius:50%;background:#fbfcfc}.task-list .step{display:block;font-size:11px;color:#a8acab;margin-bottom:8px}.task-list h3{font-size:15px;line-height:1.6;font-weight:600;color:#636766;margin-bottom:9px}.task-list p{font-size:12px}.check-list{padding-left:20px;margin:10px 0 0;color:#747877;font-size:13px}.check-list li{margin:7px 0}.source-row{display:grid;grid-template-columns:155px minmax(0,1fr);gap:24px;padding:13px 0;border-bottom:1px solid #eaebeb;font-size:12px}.source-row:last-child{border:0}.source-row dt{color:#8d9190}.source-row dd{color:#696d6c;overflow-wrap:anywhere}.description{padding:24px 28px;border-left:3px solid #ced0cf;background:#f8f8f8e8;color:#6f7472;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere;border-radius:0 13px 13px 0;margin-top:22px}.version-history{display:grid;gap:12px}.version-history>div{padding:15px 20px;border:1px solid #e7e8e8;border-radius:12px;background:#fff}.version-history strong{color:#747877;font-size:13px}.version-history p{margin-top:4px;font-size:12px}.validation-status{display:inline-block;margin-top:12px;padding:4px 9px;background:#f5f5f5;border:1px solid #e2e3e5;border-radius:6px;color:#777c7a;font-size:11px}.footer{padding:34px 0 42px;font-size:11px;color:#a0a3a2;display:flex;justify-content:space-between;gap:26px;flex-wrap:wrap}.footer p{font-size:11px}.document-links{display:flex;gap:16px;flex-wrap:wrap;margin-top:16px;font-size:12px}
@media(max-width:900px){.report-main{width:calc(100% - 44px)}.chapters{justify-content:flex-start;gap:23px}.hero{gap:20px;padding-top:35px;min-height:360px}.hero-art{height:290px}.three-col{grid-template-columns:1fr}.task-list{grid-template-columns:repeat(2,minmax(0,1fr));gap:25px}.section{padding:42px 0}.section-head{grid-template-columns:51px minmax(0,1fr);gap:17px}.number{font-size:46px}.section h2{font-size:25px}.hero-facts{padding:22px}.hero-facts dd{font-size:16px}.architecture{grid-template-columns:1fr}.architecture article:not(:last-child):after{content:"↓";right:auto;left:48%;top:auto;bottom:-18px}.two-col{gap:15px}.source-row{grid-template-columns:125px minmax(0,1fr);gap:15px}}
@media(max-width:600px){body{font-size:13px}.report-header{padding:15px 20px;gap:12px}.brand{font-size:21px}.brand small{font-size:10px;margin-left:10px;padding-left:10px}.report-tag{font-size:10px;padding:4px 8px}.chapters{padding:11px 20px;gap:20px}.chapters a{font-size:11px}.report-main{width:calc(100% - 36px)}.hero{grid-template-columns:1fr;gap:10px;padding:33px 0 29px}.hero h1{font-size:29px;line-height:1.45}.hero-summary{font-size:13px;margin-top:18px}.hero-art{height:240px}.hero-facts{gap:13px;padding:20px 16px;border-radius:15px}.hero-facts div+div{padding-left:13px}.hero-facts dt{font-size:10px}.hero-facts dd{font-size:13px}.section{padding:36px 0}.section-head{grid-template-columns:42px minmax(0,1fr);gap:14px;margin-bottom:23px}.number{font-size:38px}.section h2{font-size:23px}.section-head p:last-child{font-size:12px}.two-col{grid-template-columns:1fr}.card{padding:22px}.brief{padding:23px}.brief-text{font-size:13px}.task-list{gap:20px}.task-list h3{font-size:14px}.task-list p{font-size:12px}.description{padding:20px;font-size:12px}.source-row{grid-template-columns:1fr;gap:3px;padding:12px 0}.note{padding:17px;font-size:12px}.footer{gap:12px}.table-wrap{margin-top:18px}td,th{padding:12px}.document-links{gap:12px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}@media(prefers-reduced-transparency:reduce),(prefers-contrast:more){body{background:#f8fafb}.glass,.report-header,.chapters{background:#fcfcfc;backdrop-filter:none;border-color:#bdbfbe}.hero-summary,p{color:#5c605f}}
@media print{@page{size:A4;margin:16mm}body{background:#fff;color:#303336;font-size:11px;print-color-adjust:exact;-webkit-print-color-adjust:exact}.report-header{padding:0 0 16px;backdrop-filter:none}.report-tag{font-size:9px}.chapters{display:none}.report-main{width:100%}.hero{min-height:0;padding:27px 0 24px;gap:25px}.hero h1{font-size:29px}.hero-art{height:210px}.hero-facts{padding:18px}.hero-facts dd{font-size:14px}.section{padding:26px 0;break-inside:auto}.section-head{grid-template-columns:42px 1fr;gap:16px;margin-bottom:18px;break-after:avoid}.number{font-size:38px}.section h2{font-size:22px}.section h3{font-size:14px}.section p,.card p,.brief-text{font-size:11px}.glass,.card,.brief,.note,.description{box-shadow:none;backdrop-filter:none;break-inside:avoid}.card{padding:19px}.architecture{grid-template-columns:repeat(5,minmax(0,1fr))}.architecture article:not(:last-child):after{content:"→";left:auto;right:-12px;top:30%;bottom:auto}.two-col{grid-template-columns:repeat(2,minmax(0,1fr))}.three-col{grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.task-list{grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.task-list h3{font-size:12px}.task-list p{font-size:10px}.table-wrap{overflow:visible}table{font-size:10px}th,td{padding:10px}thead{display:table-header-group}tr{break-inside:avoid}.source-row{grid-template-columns:130px minmax(0,1fr);font-size:10px}.footer{padding:22px 0 0}a{text-decoration:none}}
${DESIGN_REPORT_OVERVIEW_CSS}
${REPORT_PLANNING_CSS}
${DESIGN_REPORT_WEBSITE_CSS}
`;

const heading = (
  id: string,
  number: string,
  english: string,
  title: string,
  note: string,
) =>
  `<header class="section-head"><span class="number">${number}</span><div><p class="kicker">${english}</p><h2 id="${id}-title">${title}</h2><p>${note}</p></div></header>`;
const card = (label: string, title: string, content: string) =>
  `<article class="card glass"><span class="mini-label">${label}</span><h3>${title}</h3>${content}</article>`;
const paragraph = (value: unknown) => `<p class="prewrap">${text(value)}</p>`;
const planningSection = (kind: "budget" | "economics") => {
  const budget = kind === "budget";
  return `<section class="section" id="${kind}" aria-labelledby="${kind}-title">${heading(kind, budget ? "05" : "06", budget ? "INVESTMENT BUDGET" : "ENTERPRISE VALUE", budget ? "投资预算" : "企业效益", budget ? "按项目实际报价与使用假设组织一次投入和年度运行成本。" : "将工时价值、现金兑现与持续运行费用分开测算。")}
<div id="report-${kind}-host" class="report-planning-host"></div><div class="report-planning-static"><p>${budget ? "硬件、软件、现场集成、预备费和年度运行费用尚未提供报价。在线方案可填写假设并实时测算；本阅读快照不附加默认预算。" : "当前没有经过确认的工时与现金节省数据。在线方案可填写自己的假设并查看年净现金、回收期和三年净额。"}</p><p class="report-formula">${budget ? "一次投入 =（数量 × 单台硬件 + 软件 + 集成）×（1 + 预备费比例）；三年总成本 = 一次投入 + 3 × 年度运行费。" : "年度净现金 = 净释放工时 × 人工成本 × 现金兑现比例 + 其他现金节省 − 年度运行费；简单回收期 = 一次投入 ÷ 正的年度净现金。"}</p></div></section>`;
};

// Exact notice retained from public/v8-assets/go2-LICENSE.txt for image redistribution.
const UNITREE_NOTICE = `Copyright (c) 2016-2022 HangZhou YuShu TECHNOLOGY CO.,LTD. ("Unitree Robotics")
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the copyright holder nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`;

export function createDesignReport(
  project: Project,
  input: DesignReportSource = {},
  options: DesignReportOptions = {},
): DesignReportResult {
  const source = resolveSource(project, input);
  const {
    template,
    approval,
    branch,
    revision,
    requirement,
    assetKey,
    title,
    versionLabel,
    parameters,
  } = source;
  const image =
    options.heroDataUrl || assetUrl(IMAGES[assetKey], options.assetBaseUrl);
  if (
    options.heroDataUrl &&
    !/^data:image\/(?:png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(
      options.heroDataUrl,
    )
  )
    throw new V8Error("REPORT_IMAGE_INVALID", "离线图像格式不受支持。");
  const route = template ? "具身资源库 · 模板适配" : "AI 定制 · 已确认概念";
  const timestamp =
    options.createdAt ||
    approval?.approvedAt ||
    project.artifacts.find((item) => item.id === input.artifactId)?.createdAt ||
    project.updatedAt;
  const artifacts = project.artifacts.filter((item) =>
    reportModelMatches(
      {
        projectId: project.id,
        requirementId: requirement.id,
        parameterSnapshot: parameters,
        templateId: template?.id,
        approvalId: approval?.id,
        branchId: branch?.id,
        revisionId: revision?.id,
        descriptionId: approval?.descriptionId,
      },
      item,
    ),
  );
  const runs = approval
    ? project.cadRuns.filter(
        (item) =>
          item.sourceApprovalId === approval.id &&
          runSourceValid(project, item),
      )
    : [];
  const available = artifacts.filter((item) => canDownload(project, item));
  const configuredModel = artifacts.some((item) => item.modelRecipe);
  const modelReference =
    template || TEMPLATE_CATALOG.find((item) => item.assetKey === assetKey);
  const sourceLabel = modelReference?.source || "Embodex 原创开发样例";
  const license = modelReference?.license || "CC0-1.0";
  const precision =
    modelReference?.precisionNote ||
    "原创结构示意与设计描述记录；不是制造级 CAD，未进行结构、物理或性能验证。";
  const capabilities =
    modelReference?.capabilities ||
    (revision?.mediaType === "image"
      ? ["二维概念查看", "文本修订", "版本来源追踪"]
      : ["概念模型查看", "文本修订", "独立版本与批准追踪"]);
  const sourceRows = requirement.sources
    .map(
      (item) =>
        `<tr><td><strong>${text(item.name)}</strong></td><td>${item.kind === "text" ? "用户明确输入" : item.parseStatus === "ready" ? "文件文本已读取" : "文件解析未完成"}</td><td>${item.location === "local-preview" ? "当前设备开发预览" : "服务端来源"}${item.sizeBytes ? ` · ${bytes(item.sizeBytes)}` : ""}</td></tr>`,
    )
    .join("");
  const parameterRows =
    modelReference?.parameters
      .map(
        (definition) =>
          `<tr><td><strong>${text(definition.label)}</strong></td><td>${text(parameters[definition.key] ?? definition.defaultValue)} ${text(definition.unit, "")}</td><td>${definition.min}–${definition.max} ${text(definition.unit, "")}</td><td>${text(definition.description)}</td></tr>`,
      )
      .join("") || "";
  const files = artifacts
    .map(
      (item) =>
        `<tr><td><strong>${text(item.fileName)}</strong><br><small>${text(item.mimeType)}</small></td><td>${bytes(item.sizeBytes)}</td><td>${canDownload(project, item) ? "文件可用" : item.status === "uploading" ? "文件上传中" : item.status === "validating" ? "文件校验中" : "尚不可交付"}</td><td>GLB 可视化模型；不等同原生 CAD</td></tr>`,
    )
    .join("");
  const latestRequirement = project.requirements.at(-1);
  const requirementWarning =
    latestRequirement && latestRequirement.id !== requirement.id
      ? `<div class="note">本方案锁定需求 ${version(requirement.sequence)}。项目当前最新需求为 ${version(latestRequirement.sequence)}；本文保留已确认来源，没有用最新需求覆盖历史方案。</div>`
      : "";
  const planned = [
    [
      "核对需求与来源",
      "复核用途、约束、附件与所选版本，列出缺失条件。",
      requirement.status === "ready"
        ? "需求已保存，业务约束仍需核对"
        : "需求已保存，关键条件待补充",
    ],
    [
      "检查设计与结构",
      template
        ? "查看来源组件和已声明能力，视觉参数与工程变更分别记录。"
        : "按独立修订保存修改，并锁定已确认描述。",
      approval ? `已确认 ${versionLabel}` : "已保存模板与视图配置",
    ],
    [
      "工程结果与文件",
      template
        ? "复用来源几何与冻结配置；模板保存不会触发 CAD。"
        : "工程任务使用同一批准记录，文件上传、校验和可用分别跟踪。",
      template
        ? "现有模板文件复用"
        : runs.length
          ? `已登记 ${runs.length} 个对应工程任务`
          : "尚无对应工程任务结果",
    ],
    [
      "验证与正式交付",
      "补充结构、性能与场景验证，取得证据后再判断可制造或可运行性。",
      "工程验证未执行",
    ],
  ];
  const sourceLinks = modelReference
    ? [
        modelReference.licenseUrl
          ? `<a href="${escape(assetUrl(modelReference.licenseUrl, options.assetBaseUrl))}">查看完整来源许可</a>`
          : "",
        modelReference.provenanceUrl
          ? `<a href="${escape(assetUrl(modelReference.provenanceUrl, options.assetBaseUrl))}">查看来源与校验记录</a>`
          : "",
      ].join("")
    : "";
  const trace = [
    ["项目", `${project.name} · ${project.id}`],
    ["项目类型", project.projectType],
    ["设计路线", route],
    ["需求版本", `${version(requirement.sequence)} · ${requirement.id}`],
    ["来源模型", assetKey],
    ["冻结支持参数", JSON.stringify(parameters)],
    ...(template
      ? [["来源模板", `${template.name} · ${template.id}`]]
      : [
          ["概念方向", `${branch!.name} · ${branch!.id}`],
          ["概念版本", `${versionLabel} · ${revision!.id}`],
          ["设计描述", approval!.descriptionId],
          ["批准记录", approval!.id],
        ]),
    ["来源与许可", `${sourceLabel} · ${license}`],
    ["方案快照时间", timestamp],
  ];
  const chapters = REPORT_CHAPTERS;
  const csp = `default-src 'none'; img-src 'self' data:${options.assetBaseUrl ? ` ${new URL(options.assetBaseUrl).origin}` : ""}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`;
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="embodex-report-format" content="${REPORT_FORMAT}"><meta http-equiv="Content-Security-Policy" content="${escape(csp)}"><meta name="referrer" content="no-referrer"><title>${text(project.name)} · ${text(title)} · 设计方案</title><style>${DESIGN_REPORT_CSS}</style></head>
<body data-report-format="${REPORT_FORMAT}" data-project-id="${text(project.id)}" data-requirement-id="${text(requirement.id)}" data-description-id="${text(approval?.descriptionId, "")}" data-approval-id="${text(approval?.id, "")}">
<header class="report-header"><div class="brand">Embodex<small>方案概览</small></div><span class="report-tag">开发预览 · 来源明确</span></header>
<div class="report-projects" aria-label="当前方案项目"><span class="project-chip">${text(project.name)}</span><span class="project-context-note">已保存方案 · ${text(versionLabel)}</span></div>
<nav class="chapters" aria-label="完整方案章节">${chapters.map(([id, label], index) => `<a href="#${id}"><i>${String(index + 1).padStart(2, "0")}</i>${label}</a>`).join("")}</nav>
<main class="report-main"><section id="overview" aria-labelledby="report-title"><div class="hero"><div><p class="kicker">01 / PROJECT BRIEF</p><p class="eyebrow">${text(route)}</p><h1 id="report-title">${text(project.name)}<span>${text(title)} · ${text(versionLabel)}</span></h1><p class="hero-summary">${text(template ? template.description : branch?.rationale)}<br>${approval ? "已确认的设计方案。" : "已保存的模型与配置。"}</p></div><figure class="hero-art"><div class="orbit" aria-hidden="true"></div><img src="${escape(image)}" alt="${text(title)}的对应模型可视化快照" width="700" height="500"><figcaption>${modelReference?.sourceKind === "licensed-reference" ? "来源网格可视化 · 保留装配坐标" : modelReference?.sourceKind === "supplied-concept-reference" ? "项目提供的精细概念源 · 非制造文件" : "原创概念样例 · 非制造文件"}</figcaption></figure></div>
<dl class="hero-facts"><div><dt>设计路线</dt><dd>${template ? "具身资源库" : "AI 定制"}</dd></div><div><dt>方案来源版本</dt><dd>${text(versionLabel)}</dd></div><div><dt>工程验证</dt><dd>尚未执行</dd></div></dl>
<div class="report-requirements" id="requirements" aria-labelledby="requirements-title">${heading("requirements", "01", "REQUIREMENTS & SOLUTION", "需求与方案", "设计目标、用途与关键约束。")}
<div class="brief glass"><span class="mini-label">原始设计需求 · ${version(requirement.sequence)}</span><p class="brief-text prewrap">${text(requirement.text)}</p></div>
<div class="two-col">${card("USER INPUT", "主要用途与任务", paragraph(requirement.purpose))}${card("CONSTRAINTS", "关键约束", paragraph(requirement.constraints))}</div>
${requirement.missingFields.length ? `<div class="note"><strong>下一步需要确认</strong><ul class="check-list">${requirement.missingFields.map((item) => `<li>${text(item)}</li>`).join("")}</ul></div>` : '<div class="note">设计约束待工程验证。</div>'}
<div class="table-wrap"><table><thead><tr><th>需求来源</th><th>内容状态</th><th>保存位置</th></tr></thead><tbody>${sourceRows}</tbody></table></div>${requirementWarning}</div></section>
<section class="section" id="interactive" aria-labelledby="interactive-title">${heading("interactive", "02", "INTERACTIVE SOLUTION", "交互式方案", "模型查看、零件拆解与感知预览。")}
<div id="report-interactive-host" class="report-interactive-host"></div><figure class="report-interactive-fallback"><img src="${escape(image)}" alt="${text(title)}的方案来源模型阅读图" width="700" height="500"><figcaption><p>离线阅读图；在线可交互查看。</p></figcaption></figure></section>
<section class="section" id="structure" aria-labelledby="structure-title">${heading("structure", "03", "OVERALL SOLUTION", "整体方案", "本体结构、支持能力与来源。")}
<div class="three-col">${card("BODY & ASSEMBLY", "本体与结构", paragraph(template?.description || branch?.differentiator))}${card("VIEW & REVIEW", "查看与修改能力", `<p>${capabilities.map((item) => `<span class="pill">${text(item)}</span>`).join("")}</p><p>${revision?.mediaType === "image" ? "二维概念图，支持文字修改。" : template ? "按来源组件查看与拆解。" : "概念用于方向讨论；文字修改记录在设计描述中。"}</p>`)}${card("SOURCE & PRECISION", "来源与精度", `<p>${text(sourceLabel)}</p><p>${text(precision)}</p>`)}</div>
${approval ? `<div class="description"><span class="mini-label">已确认的设计描述 · ${text(versionLabel)}</span>${text(approval.description)}</div><div class="note">描述快照对应 ${text(approval.descriptionId)}。新修订不改写此方案。</div>` : configuredModel ? '<div class="note">受支持参数已冻结并导出到配置 GLB；未调用 SolidWorks。</div>' : '<div class="note">复用来源模板，下载文件保留原始几何。</div>'}
${parameterRows ? `<div class="table-wrap"><table><thead><tr><th>支持参数</th><th>本次配置</th><th>范围</th><th>作用与限制</th></tr></thead><tbody>${parameterRows}</tbody></table></div>` : `<div class="note">${template ? "此模型支持查看与拆解，无可编辑参数。" : "此版本支持文字迭代，无可编辑结构参数。"}</div>`}
<div class="architecture" aria-label="方案来源链路">${[
    ["需求版本", version(requirement.sequence)],
    ["设计来源", template ? "已保存模板" : versionLabel],
    ["确认依据", template ? "模板适配记录" : "不可变批准快照"],
    ["结果状态", template ? "来源文件复用" : "独立工程任务"],
    ["成果交付", "文档与实际模型"],
  ]
    .map(([a, b]) => `<article><b>${a}</b><small>${b}</small></article>`)
    .join("")}</div>
${
  branch
    ? `<h3 style="margin:30px 0 15px">当前方向的版本历程</h3><div class="version-history">${branch.revisions
        .filter((item) => item.sequence <= revision!.sequence)
        .map(
          (item) =>
            `<div><strong>${version(item.sequence)}${item.id === revision!.id ? " · 本方案来源" : ""}</strong><p class="prewrap">${text(item.changeSummary)}</p></div>`,
        )
        .join("")}</div>`
    : ""
}</section>
<section class="section" id="scenario" aria-labelledby="scenario-title">${heading("scenario", "04", "SCENARIO & TASKS", "场景任务", "场景目标、任务步骤与验收条件。")}
<div class="brief glass"><span class="mini-label">已保存的场景与任务</span><p class="brief-text prewrap">${text(requirement.purpose)}</p><p class="prewrap">${text(requirement.constraints)}</p></div>
<ol class="task-list">${planned.map(([name, description, status], index) => `<li><span class="step">PHASE ${String(index + 1).padStart(2, "0")}</span><h3>${name}</h3><p>${description}</p><span class="validation-status">${text(status)}</span></li>`).join("")}</ol>
<div class="two-col">${card("STRUCTURAL CHECKS", "结构与接口待验证", '<ul class="check-list"><li>按实际需求核对外廓、装配关系与安装接口。</li><li>对载荷、强度、运动范围与干涉开展工程检查。</li><li>把可视部件与制造零件、采购件、BOM 分开核实。</li></ul>')}${card("TASK ACCEPTANCE", "任务与场景待验证", '<ul class="check-list"><li>把用户约束转换为可测量的验收条件。</li><li>检查感知覆盖、工作环境与异常恢复要求。</li><li>保存真实验证证据后，再判断是否满足任务。</li></ul>')}</div>
<div class="report-task-details"><details><summary>任务执行与异常处理</summary><p>先核对现场边界、允许操作和人工接管方式，再执行对应任务。识别失败、路径受阻、接口异常或电量不足时，应停止并进入经确认的恢复流程；这些行为仍需真实系统实现与测试。</p></details><details><summary>场景验收与证据记录</summary><p>以本方案保存的任务与约束为输入，补充可测量的成功条件，记录每项测试的环境、结果和证据。模型查看、拆解或感知示意本身不构成任务完成证据。</p></details></div>
<div class="note">当前没有验证结果，不能据此宣称可制造、可运行、达到载荷、精度或续航指标。预算与效益章节的在线输入属于单独的用户测算假设。</div></section>
${planningSection("budget")}${planningSection("economics")}
<section class="section" id="delivery" aria-labelledby="delivery-title">${heading("delivery", "07", "DELIVERY & TRACEABILITY", "交付流程", "核对方案版本、文件可用状态、来源与许可，再完成浏览、导出与交付。")}
<div class="two-col">${card("DESIGN DOCUMENT", "设计方案", `<p>包含需求、方案、配置与来源，可打印或另存为 PDF。</p><p>本文是 ${text(versionLabel)} 的固定快照。历史版本可随时查看。</p>`)}${card("MODEL & ENGINEERING FILES", "三维模型与工程文件", `<p>${available.length ? `已登记 ${available.length} 个可用模型文件。` : "本快照尚未登记可交付的就绪模型文件。"}</p><p>GLB 可视化文件；原生 CAD 与工程验证待完成。</p>`)}</div>
<div class="table-wrap"><table><thead><tr><th>实际模型文件</th><th>大小</th><th>状态</th><th>格式与边界</th></tr></thead><tbody>${files || '<tr><td colspan="4">当前来源尚无已登记的模型文件，请返回工作区核实任务与文件状态。</td></tr>'}</tbody></table></div>
<div class="glass card" style="margin-top:24px"><dl>${trace.map(([label, value]) => `<div class="source-row"><dt>${text(label)}</dt><dd>${text(value)}</dd></div>`).join("")}</dl>${sourceLinks ? `<div class="document-links">${sourceLinks}</div>` : ""}</div>
<div class="note">${text(branch?.limitation || precision)}${template?.sourceKind === "licensed-reference" ? "<br>来源网格保留原始版权与完整许可条款，不表示版权方对本方案作出认可。" : ""}<br>版式参考用户提供的 EmboMiX 官网“查看完整方案”，原站设计与代码归属保持不变。开发预览不等同真实 AI/CAD 服务已接入。</div>
${license.includes("BSD-3-Clause") ? `<details class="note"><summary>来源网格许可 · BSD-3-Clause 完整声明</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.8 ui-monospace,monospace;margin-top:16px">${escape(UNITREE_NOTICE)}</pre></details>` : ""}
${modelReference?.sourceKind === "supplied-concept-reference" ? '<div class="note">本模型来自用户提供的官网概念源，按本次明确授权复用。来源未声明独立的 SPDX 再分发许可；不将其重新标为 CC0，不推断全球再分发许可或制造精度。</div>' : ""}</section>
<footer class="footer"><p>Embodex · 从需求到方案<br>来源固定，版本可追溯。</p><p>${text(project.name)} · ${text(versionLabel)}<br>HTML 设计方案 · ${REPORT_FORMAT}</p></footer></main></body></html>`;
  return {
    html,
    fileName: `embodex-${filename(project.name)}-${approval ? version(revision!.sequence) : filename(template!.assetKey)}.html`,
    mimeType: "text/html;charset=utf-8",
    sizeBytes: new TextEncoder().encode(html).byteLength,
    source: { ...source.selector, assetKey, versionLabel },
  };
}

/** Embed known local hero images, preserving every byte of frozen source text. */
export async function embedDesignReportHtml(
  html: string,
  options: {
    baseUrl?: string;
    signal?: AbortSignal;
    fetcher?: typeof fetch;
  } = {},
): Promise<{ html: string; embeddedCount: number; sizeBytes: number }> {
  if (!html.includes(`content="${REPORT_FORMAT}"`))
    throw new V8Error(
      "REPORT_FORMAT_INVALID",
      "不是受支持的 Embodex 方案格式。",
    );
  const base =
    options.baseUrl ||
    (typeof window !== "undefined" ? window.location.origin : undefined);
  if (!base)
    throw new V8Error(
      "REPORT_ASSET_ORIGIN",
      "离线导出需要提供当前工作区地址。",
    );
  const origin = new URL(base).origin;
  const known = new Set([
    ...["q4", "c2"].flatMap((id) =>
      ["engineering", "sensors", "task"].map(
        (kind) => `/v8-assets/official-${id}-${kind}.png`,
      ),
    ),
    ...Object.values(IMAGES),
    "/v8-assets/inspection-reference.png",
    "/v8-assets/mobile-reference.png",
  ]);
  const matches = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)];
  let embedded = html,
    count = 0;
  const imageCache = new Map<string, string>();
  for (const match of matches) {
    const source = match[1];
    if (source.startsWith("data:image/")) continue;
    const url = new URL(source.replace(/&amp;/g, "&"), origin);
    if (
      url.origin !== origin ||
      !known.has(url.pathname) ||
      url.search ||
      url.hash
    )
      throw new V8Error(
        "REPORT_ASSET_UNTRUSTED",
        "方案包含未受控的外部图像，已停止离线导出。",
      );
    const cached = imageCache.get(url.href);
    if (cached) {
      embedded = embedded.replace(`src="${source}"`, `src="${cached}"`);
      continue;
    }
    const response = await (options.fetcher || fetch)(url.href, {
      credentials: "same-origin",
      signal: options.signal,
    });
    if (!response.ok)
      throw new V8Error(
        "REPORT_IMAGE_UNAVAILABLE",
        "方案预览图暂不可用，请稍后重试导出。",
      );
    const content = new Uint8Array(await response.arrayBuffer());
    if (!content.length || content.byteLength > 8 * 1024 * 1024)
      throw new V8Error(
        "REPORT_IMAGE_INVALID",
        "方案预览图为空或超过大小限制。",
      );
    const png =
      url.pathname.endsWith(".png") &&
      content.length >= 8 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every(
        (value, index) => content[index] === value,
      );
    const svgText = url.pathname.endsWith(".svg")
      ? new TextDecoder().decode(content)
      : "";
    const svg = /^\s*(?:<\?xml[^>]*>\s*)?<svg\b/.test(svgText);
    if (!png && !svg)
      throw new V8Error("REPORT_IMAGE_INVALID", "方案图像内容与扩展名不一致。");
    if (
      svg &&
      /<(?:script|foreignObject)\b|(?:href|src)\s*=\s*["']\s*(?:https?:|javascript:|\/\/)/i.test(
        svgText,
      )
    )
      throw new V8Error(
        "REPORT_IMAGE_UNTRUSTED",
        "方案 SVG 包含外部资源或活动内容，已停止导出。",
      );
    let binary = "";
    for (let i = 0; i < content.length; i += 32768)
      binary += String.fromCharCode(...content.subarray(i, i + 32768));
    const data = `data:image/${png ? "png" : "svg+xml"};base64,${btoa(binary)}`;
    imageCache.set(url.href, data);
    embedded = embedded.replace(`src="${source}"`, `src="${data}"`);
    count++;
  }
  return {
    html: embedded,
    embeddedCount: count,
    sizeBytes: new TextEncoder().encode(embedded).byteLength,
  };
}
