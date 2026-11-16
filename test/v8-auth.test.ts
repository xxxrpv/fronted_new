/** F01/F02/F20: offline contract/component tests. These do not prove a live backend session. */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { evaluateRouteGuard } from "../lib/auth-guard";
import { normalizeAuthError } from "../lib/auth-errors";
import { HubApiError, platformJson } from "../lib/hub/api";

type Account = {
  user: { id: string; displayName: string };
  subscription: null;
};
const account = (id: string): Account => ({
  user: { id, displayName: id },
  subscription: null,
});
type Reply = { data?: Account; error?: unknown; response?: { status: number } };

/** Execute the actual AuthProvider with a small hook host and replace only its HTTP/storage dependencies. */
function providerHarness() {
  const slots: unknown[] = [];
  const revoked: string[] = [];
  const cleared: string[] = [];
  const reads: Array<() => Promise<Reply>> = [];
  const logouts: Array<() => Promise<Reply>> = [];
  let cursor = 0;
  const fakeReact = {
    createContext: () => ({ Provider: "provider" }),
    createElement: (_type: unknown, props: { value: unknown }) => ({ props }),
    useContext: () => undefined,
    useState: (initial: unknown) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [
        slots[index],
        (value: unknown) => {
          slots[index] =
            typeof value === "function"
              ? (value as (old: unknown) => unknown)(slots[index])
              : value;
        },
      ];
    },
    useRef: (initial: unknown) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback: (callback: unknown) => callback,
    useMemo: (factory: () => unknown) => factory(),
    // Tests explicitly call refreshUser to control asynchronous completion order.
    useEffect: () => {},
  };
  const module = {
    exports: {} as {
      AuthProvider: (props: unknown) => { props: { value: AuthValue } };
    },
  };
  const code = ts.transpileModule(
    readFileSync(
      fileURLToPath(new URL("../lib/auth-context.tsx", import.meta.url)),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
      },
    },
  ).outputText;
  const dependencies = (id: string) => {
    if (id === "react")
      return { __esModule: true, default: fakeReact, ...fakeReact };
    if (id === "./api")
      return {
        getCurrentUser: async (options: {
          headers: Record<string, string>;
        }) => {
          assert.equal(options.headers["Cache-Control"], "no-store");
          assert.equal(options.headers.Authorization, undefined);
          assert(reads.length, "unexpected session request");
          return reads.shift()!();
        },
        logout: async () => {
          assert(logouts.length, "unexpected logout request");
          return logouts.shift()!();
        },
      };
    if (id === "./auth-errors") return { normalizeAuthError };
    if (id === "./embodex/conversation-storage")
      return {
        revokeUserConversations: (id: string) => revoked.push(id),
        clearUserStoredConversation: (id: string) => cleared.push(id),
      };
    throw new Error(`unexpected dependency ${id}`);
  };
  new Function("require", "module", "exports", code)(
    dependencies,
    module,
    module.exports,
  );
  function render() {
    cursor = 0;
    return module.exports.AuthProvider({ children: null }).props.value;
  }
  return { render, reads, logouts, revoked, cleared };
}
interface AuthValue {
  status: "loading" | "authenticated" | "unauthenticated" | "error";
  user: { id: string } | null;
  error: { code: string; message: string } | null;
  refreshUser(): Promise<Account | null>;
  logout(): Promise<boolean>;
}

describe("V8 authentication boundaries — actual provider and offline transports", () => {
  test("F01 unauthenticated deep link preserves destination; pending/error states expose no protected view", () => {
    const destination = "/projects/project-a/embodex";
    const guard = evaluateRouteGuard(destination, "unauthenticated");
    assert.equal(
      guard.redirectUrl,
      `/login?next=${encodeURIComponent(destination)}`,
    );
    assert.equal(guard.viewType, "unauthenticated");
    for (const status of ["loading", "error"] as const) {
      const pending = evaluateRouteGuard(destination, status);
      assert.equal(pending.shouldRedirect, false);
      assert.notEqual(pending.viewType, "protected_content");
    }
  });

  test("F02 actual session refresh authenticates before a safe return route becomes accessible", async () => {
    const host = providerHarness();
    assert.equal(host.render().status, "loading");
    host.reads.push(async () => ({
      data: account("alice"),
      response: { status: 200 },
    }));
    assert.equal((await host.render().refreshUser())?.user.id, "alice");
    const auth = host.render();
    assert.equal(auth.status, "authenticated");
    const destination = "/projects/project-a/embodex?taskId=existing";
    assert.equal(
      evaluateRouteGuard("/login", auth.status, destination).redirectUrl,
      destination,
    );
    assert.equal(
      evaluateRouteGuard("/projects/project-a/embodex", auth.status).viewType,
      "protected_content",
    );
    for (const unsafe of [
      "https://external.invalid/",
      "//external.invalid/",
      "/login",
      "/\\external.invalid/",
    ]) {
      assert.equal(
        evaluateRouteGuard("/login", auth.status, unsafe).redirectUrl,
        "/projects",
      );
    }
  });

  test("F20 forbidden session preserves error state, rejects access and does not pretend logout", async () => {
    const host = providerHarness();
    host.reads.push(async () => ({
      data: account("alice"),
      response: { status: 200 },
    }));
    await host.render().refreshUser();
    host.reads.push(async () => ({
      error: { error: { code: "FORBIDDEN", message: "无权访问此项目" } },
      response: { status: 403 },
    }));
    assert.equal(await host.render().refreshUser(), null);
    const auth = host.render();
    assert.equal(auth.status, "error");
    assert.equal(auth.user?.id, "alice");
    assert.equal(auth.error?.code, "FORBIDDEN");
    assert.equal(
      evaluateRouteGuard("/projects/other", auth.status).viewType,
      "error",
    );
    assert.deepEqual(host.revoked, []);
  });

  test("401 revokes cached user data; service and network errors remain recoverable", async () => {
    const host = providerHarness();
    host.reads.push(async () => ({ data: account("alice") }));
    await host.render().refreshUser();
    host.reads.push(async () => {
      throw new TypeError("Failed to fetch");
    });
    await host.render().refreshUser();
    assert.equal(host.render().status, "error");
    assert.equal(host.render().error?.code, "NETWORK_ERROR");
    assert.equal(host.render().user?.id, "alice");
    host.reads.push(async () => ({
      error: { error: { code: "SERVICE_UNAVAILABLE" } },
      response: { status: 503 },
    }));
    await host.render().refreshUser();
    assert.equal(host.render().status, "error");
    host.reads.push(async () => ({ data: account("alice") }));
    await host.render().refreshUser();
    assert.equal(host.render().status, "authenticated");
    host.reads.push(async () => ({ response: { status: 401 } }));
    await host.render().refreshUser();
    assert.equal(host.render().status, "unauthenticated");
    assert.equal(host.render().user, null);
    assert.deepEqual(host.revoked, ["alice"]);
    assert.deepEqual(host.cleared, ["alice"]);
  });

  test("late old-account responses cannot overwrite the current account", async () => {
    const host = providerHarness();
    let resolveOld!: (reply: Reply) => void;
    host.reads.push(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    const oldRequest = host.render().refreshUser();
    host.reads.push(async () => ({ data: account("bob") }));
    await host.render().refreshUser();
    resolveOld({ data: account("alice") });
    assert.equal(await oldRequest, null);
    assert.equal(host.render().user?.id, "bob");
  });

  test("logout failures retain session; successful logout clears it", async () => {
    const host = providerHarness();
    host.reads.push(async () => ({ data: account("alice") }));
    await host.render().refreshUser();
    host.logouts.push(async () => ({ response: { status: 500 } }));
    assert.equal(await host.render().logout(), false);
    assert.equal(host.render().status, "authenticated");
    host.logouts.push(async () => ({ response: { status: 204 } }));
    assert.equal(await host.render().logout(), true);
    assert.equal(host.render().status, "unauthenticated");
    assert.deepEqual(host.revoked, ["alice"]);
  });

  test("F20 same-origin transport retains 403/401/503 distinctions, Cookie credentials and server error codes", async () => {
    for (const [status, code] of [
      [403, "PROJECT_FORBIDDEN"],
      [401, "AUTHENTICATION_REQUIRED"],
      [503, "SERVICE_UNAVAILABLE"],
    ] as const) {
      const transport: typeof fetch = async (url, init) => {
        assert.equal(url, "/api/v1/projects/private-project");
        assert.equal(init?.credentials, "same-origin");
        assert.equal(new Headers(init?.headers).get("Authorization"), null);
        return new Response(
          JSON.stringify({ error: { code, message: "请求未完成" } }),
          { status, headers: { "content-type": "application/json" } },
        );
      };
      await assert.rejects(
        platformJson("/api/v1/projects/private-project", {}, transport),
        (error: unknown) => {
          assert(error instanceof HubApiError);
          assert.equal(error.status, status);
          assert.equal(error.code, code);
          return true;
        },
      );
    }
  });
});
