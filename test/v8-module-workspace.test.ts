import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildWorkspaceProjects,
  filterWorkspaceProjects,
  matchesModuleSelection,
  moduleSelectionKey,
  normalizeModules,
  parseWorkspaceProjects,
  parseWorkspaceView,
  resolveDesignScope,
  toggleModule,
  WORKSPACE_EXAMPLES,
  type ModuleId,
} from "../lib/v8/module-workspace";

test("Workspace view preserves search and selection independently of project facts and migrates the old scope", () => {
  assert.deepEqual(parseWorkspaceView(null, '["simcore","embodex"]'), {
    modules: ["embodex", "simcore"],
    search: "",
    projectId: null,
  });
  const view = {
    modules: ["deployx", "embodex", "invalid"],
    search: "巡检",
    projectId: "workspace-local-1",
  };
  assert.deepEqual(parseWorkspaceView(JSON.stringify(view)), {
    modules: ["embodex", "deployx"],
    search: "巡检",
    projectId: "workspace-local-1",
  });
  assert.deepEqual(view.modules, ["deployx", "embodex", "invalid"]);
});

test("Malformed persisted views cannot become navigation destinations", () => {
  const empty = { modules: [], search: "", projectId: null };
  assert.deepEqual(parseWorkspaceView("broken"), empty);
  assert.deepEqual(parseWorkspaceView("null"), empty);
  const view = parseWorkspaceView(
    JSON.stringify({
      modules: ["unknown"],
      search: "x".repeat(200),
      projectId: "https://example.com",
    }),
  );
  assert.equal(view.search.length, 120);
  assert.equal(view.projectId, null);
  assert.deepEqual(view.modules, []);
});

test("Direct design links use actual ownership while an empty design start cannot match an unlinked example", () => {
  assert.deepEqual(
    resolveDesignScope(WORKSPACE_EXAMPLES, undefined, ["embodex"]),
    ["embodex"],
  );
  assert.deepEqual(
    resolveDesignScope(WORKSPACE_EXAMPLES, undefined, ["simcore"]),
    ["embodex"],
  );
  const owned = { ...WORKSPACE_EXAMPLES[2], embodexProjectId: "design-1" };
  assert.deepEqual(resolveDesignScope([owned], "design-1", ["embodex"]), [
    "embodex",
    "simcore",
  ]);
  assert.deepEqual(
    resolveDesignScope([owned], undefined, ["deployx", "embodex"]),
    ["embodex", "deployx"],
  );
});

test("A combined project uses its actual design update time without rewriting stored metadata", () => {
  const owned = { ...WORKSPACE_EXAMPLES[2], embodexProjectId: "design-1" };
  const date = owned.updatedAt;
  const projects = buildWorkspaceProjects(
    [{ id: "design-1", name: "Design", updatedAt: "2026-11-15T08:00:00Z" }],
    [owned],
  );
  assert.equal(projects.length, 1);
  assert.equal(projects[0].updatedAt, "2026-11-15T08:00:00Z");
  assert.equal(owned.updatedAt, date);
});

test("Workspace composition is canonical, unique and limited to supported modules", () => {
  assert.deepEqual(
    normalizeModules(["deployx", "embodex", "embodex", "unknown", "simcore"]),
    ["embodex", "simcore", "deployx"],
  );
  assert.deepEqual(normalizeModules("embodex"), []);
  assert.equal(moduleSelectionKey(["deployx", "embodex"]), "embodex+deployx");
});

test("Selecting a module toggles metadata without mutating previous selection", () => {
  const original: ModuleId[] = ["deployx"];
  assert.deepEqual(toggleModule(original, "embodex"), ["embodex", "deployx"]);
  assert.deepEqual(original, ["deployx"]);
  assert.deepEqual(toggleModule(original, "deployx"), []);
});

test("A module selection matches its exact project composition", () => {
  assert.equal(matchesModuleSelection(["embodex"], ["embodex"]), true);
  assert.equal(
    matchesModuleSelection(["embodex", "simcore"], ["embodex"]),
    false,
  );
  assert.equal(
    matchesModuleSelection(["embodex"], ["embodex", "simcore"]),
    false,
  );
  assert.equal(
    matchesModuleSelection(["simcore", "embodex"], ["embodex", "simcore"]),
    true,
  );
  assert.equal(matchesModuleSelection(["simcore"], []), true);
});

test("Workspace projects preserve actual design identity and keep composition examples separate", () => {
  const actual = [
    {
      id: "user-design",
      name: "My Robot",
      updatedAt: "2026-11-15T00:00:00.000Z",
    },
  ];
  const before = JSON.stringify(actual);
  const projects = buildWorkspaceProjects(actual);
  assert.equal(JSON.stringify(actual), before);
  assert.equal(projects[0].embodexProjectId, "user-design");
  assert.equal(projects[0].source, "embodex");
  assert.deepEqual(projects[0].modules, ["embodex"]);
  assert(
    projects
      .slice(1)
      .every(
        (project) =>
          project.source === "workspace-example" && !project.embodexProjectId,
      ),
  );
});

test("Every offered single module or composition has a labelled workspace example", () => {
  const keys = new Set(
    buildWorkspaceProjects([
      { id: "design", name: "Design", updatedAt: "2026-11-15" },
    ]).map((project) => moduleSelectionKey(project.modules)),
  );
  for (const key of [
    "embodex",
    "simcore",
    "deployx",
    "embodex+simcore",
    "embodex+deployx",
    "simcore+deployx",
    "embodex+simcore+deployx",
  ])
    assert(keys.has(key));
  assert(
    WORKSPACE_EXAMPLES.every((project) =>
      project.summary?.includes("示例项目"),
    ),
  );
});

test("Project filtering combines exact composition and case-insensitive title search", () => {
  const projects = buildWorkspaceProjects([
    { id: "robot", name: "Q4 Robot", updatedAt: "2026-11-15" },
  ]);
  assert.deepEqual(
    filterWorkspaceProjects(projects, ["embodex"], " ROBOT ").map(
      (project) => project.id,
    ),
    ["robot"],
  );
  assert.equal(
    filterWorkspaceProjects(projects, ["embodex", "simcore"]).length,
    1,
  );
  assert.equal(
    filterWorkspaceProjects(projects, ["embodex"], "missing").length,
    0,
  );
});

test("Untrusted workspace metadata cannot overwrite actual project identity or introduce empty modules", () => {
  const projects = buildWorkspaceProjects(
    [{ id: "design", name: "Actual", updatedAt: "2026-11-15" }],
    [
      {
        id: "design",
        name: "Replacement",
        updatedAt: "2026-11-16",
        source: "workspace-local",
        modules: ["deployx"],
      },
      {
        id: "invalid",
        name: "Unknown",
        updatedAt: "2026-11-16",
        source: "workspace-local",
        modules: [],
      },
    ],
  );
  assert.equal(projects.length, 1);
  assert.equal(projects[0].name, "Actual");
  assert.deepEqual(projects[0].modules, ["embodex"]);
});

test("A composition-owned design appears only under its composition, never duplicated as a solo design", () => {
  const projects = buildWorkspaceProjects(
    [{ id: "design", name: "Actual", updatedAt: "2026-11-15" }],
    [
      {
        id: "workspace-local-1",
        name: "Combined",
        modules: ["embodex", "simcore"],
        updatedAt: "2026-11-15",
        source: "workspace-local",
        embodexProjectId: "design",
      },
    ],
  );
  assert.equal(projects.length, 1);
  assert.equal(projects[0].embodexProjectId, "design");
  assert.equal(filterWorkspaceProjects(projects, ["embodex"]).length, 0);
  assert.equal(
    filterWorkspaceProjects(projects, ["embodex", "simcore"]).length,
    1,
  );
});

test("Local metadata parser rejects invalid entries and strips arbitrary URLs", () => {
  assert.deepEqual(parseWorkspaceProjects("broken"), []);
  assert.deepEqual(parseWorkspaceProjects('{"projects":[]}'), []);
  const valid = {
    id: "local-1",
    name: " Combined ",
    modules: ["simcore", "embodex"],
    updatedAt: "2026-11-15",
    source: "workspace-local",
    embodexProjectId: "actual-1",
    url: "https://example.com",
  };
  const projects = parseWorkspaceProjects(
    JSON.stringify([
      valid,
      valid,
      { ...valid, id: "bad", modules: ["unknown"] },
      { ...valid, id: "example", source: "workspace-example" },
    ]),
  );
  assert.equal(projects.length, 1);
  assert.deepEqual(projects[0].modules, ["embodex", "simcore"]);
  assert.equal(projects[0].name, "Combined");
  assert.equal(projects[0].embodexProjectId, "actual-1");
  assert(!("url" in projects[0]));
});
