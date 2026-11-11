// @vitest-environment node
//
// Card 739db945: the MCP route must serve BOTH protocol eras on one endpoint.
// mcp-handler 2.x speaks the 2026-07-28 protocol and hard-codes legacy:"stateless"
// for older clients (claude.ai connectors, Claude Desktop, Codex, Claude Code's
// older modes). This test imports the REAL route module (only Supabase is faked)
// and drives it in-process with a real @modelcontextprotocol/client for the new
// era and raw JSON-RPC for the old one.
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";

function makeToken(): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({
    sub: USER_ID,
    session_id: SESSION_ID,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.sig`;
}
const TOKEN = makeToken();

const logInserts: Record<string, unknown>[] = [];

vi.mock("@supabase/supabase-js", () => {
  // A chain that resolves to an empty successful result however it is awaited.
  const chain = (): unknown =>
    new Proxy(() => undefined, {
      get(_t, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
        }
        return () => chain();
      },
    });
  const makeClient = () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
    },
    from: (table: string) => {
      if (table === "mcp_tool_log") {
        return {
          insert: (entry: Record<string, unknown>) => {
            logInserts.push(entry);
            return Promise.resolve({ error: null });
          },
        };
      }
      return chain();
    },
  });
  return { createClient: () => makeClient() };
});

type RouteModule = {
  GET: (req: Request) => Promise<Response>;
  POST: (req: Request) => Promise<Response>;
};
let route: RouteModule;

beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
  route = (await import("./[[...transport]]/route")) as unknown as RouteModule;
});

beforeEach(() => {
  logInserts.length = 0;
});

const URL_ = "http://localhost/api/mcp";
const baseHeaders = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

async function rawPost(body: unknown, token: string | null = TOKEN) {
  const headers: Record<string, string> = { ...baseHeaders };
  if (token) headers.authorization = `Bearer ${token}`;
  return route.POST(new Request(URL_, { method: "POST", headers, body: JSON.stringify(body) }));
}

async function parseRpc(res: Response) {
  const text = await res.text();
  const m = text.match(/^data: (.*)$/m);
  return JSON.parse(m ? m[1] : text);
}

// fetch that goes straight into the route handler
const inProcessFetch = (async (input: unknown, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  return req.method === "GET" ? route.GET(req) : route.POST(req);
}) as typeof fetch;

async function connectNewEra() {
  const client = new Client(
    { name: "two-eras-test", version: "0.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } }
  );
  const transport = new StreamableHTTPClientTransport(new URL(URL_), {
    fetch: inProcessFetch,
    requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
  });
  await client.connect(transport);
  return client;
}

describe("MCP route serves both protocol eras on one endpoint (card 739db945)", () => {
  it("old era: raw initialize returns the server name and instructions", async () => {
    const res = await rawPost({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "old-client", version: "0" },
      },
    });
    expect(res.status).toBe(200);
    const body = await parseRpc(res);
    expect(body.result.serverInfo.name).toBe("vibecodes");
    expect(typeof body.result.instructions).toBe("string");
    expect(body.result.instructions.length).toBeGreaterThan(0);
  });

  it("old era: tools/list returns all 91 tools", async () => {
    const res = await rawPost({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    expect(res.status).toBe(200);
    const body = await parseRpc(res);
    expect(body.result.tools).toHaveLength(91);
    for (const t of body.result.tools) {
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.inputSchema.type).toBe("object");
    }
  });

  it("new era: a 2026-07-28 client connects with no fallback and lists the same tools in the same order", async () => {
    const oldRes = await rawPost({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} });
    const oldNames = (await parseRpc(oldRes)).result.tools.map((t: { name: string }) => t.name);

    const client = await connectNewEra();
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(oldNames);
      expect(tools).toHaveLength(91);
    } finally {
      await client.close();
    }
  });

  it("old era tool call is logged with user id and a session id taken from the token", async () => {
    const res = await rawPost({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "get_my_tasks", arguments: {} },
    });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(logInserts.length).toBe(1));
    expect(logInserts[0]).toMatchObject({
      tool_name: "get_my_tasks",
      user_id: USER_ID,
      mode: "remote",
      session_id: SESSION_ID,
    });
  });

  it("new era tool call is logged with user id and a session id taken from the token", async () => {
    const client = await connectNewEra();
    try {
      await client.callTool({ name: "get_my_tasks", arguments: {} });
    } finally {
      await client.close();
    }
    await vi.waitFor(() => expect(logInserts.length).toBeGreaterThanOrEqual(1));
    expect(logInserts[0]).toMatchObject({
      tool_name: "get_my_tasks",
      user_id: USER_ID,
      mode: "remote",
      session_id: SESSION_ID,
    });
  });

  it("no token: 401 JSON invalid_token with a resource_metadata challenge", async () => {
    const res = await rawPost({ jsonrpc: "2.0", id: 5, method: "tools/list", params: {} }, null);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("invalid_token");
    expect(res.headers.get("www-authenticate") ?? "").toContain("resource_metadata");
  });

  it("authenticated GET is answered 405 (old clients' stream probe), not an error page", async () => {
    const res = await route.GET(
      new Request(URL_, {
        method: "GET",
        headers: { accept: "text/event-stream", authorization: `Bearer ${TOKEN}` },
      })
    );
    expect(res.status).toBe(405);
  });
});
