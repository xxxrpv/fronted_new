import { client } from "./generated/client.gen";

// The platform API is served from the same origin under /api/v1.
client.setConfig({ baseUrl: "" });

export interface CheckProjectNameOptions {
  name: string;
  excludeProjectId?: string;
  signal?: AbortSignal;
}

export interface CheckProjectNameResult {
  exists: boolean;
  available: boolean;
}

export async function checkProjectName(
  options: CheckProjectNameOptions,
): Promise<{ data?: CheckProjectNameResult; error?: unknown }> {
  return client.get<CheckProjectNameResult, unknown>({
    url: '/api/v1/projects/check-name',
    query: {
      name: options.name,
      ...(options.excludeProjectId ? { excludeProjectId: options.excludeProjectId } : {}),
    },
    signal: options.signal,
  });
}

export { client };
export * from "./generated";
