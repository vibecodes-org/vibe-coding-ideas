// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { VIBECODES_USER_ID } from "@/lib/constants";

/**
 * Regression guard for board card 23cecd8a: create_bot_user, update_bot_user
 * and delete_bot_user are SECURITY DEFINER and used to trust the caller's
 * p_owner_id, with EXECUTE held by anon and PUBLIC. So anyone holding the
 * public anon key could create, rename or delete an agent in someone else's
 * name.
 *
 * Postgres permissions aren't reachable from Vitest. So this replays the
 * migrations folder in order and checks the definition and grants that the
 * folder leaves in force (the last CREATE OR REPLACE of each function, and the
 * net GRANT/REVOKE sequence). The live behaviour was proven on the production
 * schema in a dry run that aborted (see docs/notes/23cecd8a.md).
 */

const MIGRATIONS_DIR = path.join(__dirname, "../../supabase/migrations");
const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => /^\d{5}_.*\.sql$/.test(f))
  .sort();
const migrations = files.map((f) => ({
  file: f,
  sql: readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"),
}));

/** Body of the last `CREATE [OR REPLACE] FUNCTION public.<name>(` in the folder. */
function latestDefinition(name: string): { file: string; header: string; body: string } | null {
  const header = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
  let found: { file: string; header: string; body: string } | null = null;
  for (const { file, sql } of migrations) {
    for (const m of sql.matchAll(header)) {
      const rest = sql.slice(m.index);
      const open = rest.match(/AS\s+(\$[A-Za-z_]*\$)/);
      if (!open || open.index === undefined) continue;
      const tag = open[1];
      const start = open.index + open[0].length;
      const end = rest.indexOf(tag, start);
      found = {
        file,
        header: rest.slice(0, open.index),
        body: rest.slice(start, end === -1 ? undefined : end),
      };
    }
  }
  return found;
}

/** Strip `--` comments so a comment that mentions auth.uid() can't satisfy a check. */
function code(body: string): string {
  return body.replace(/--[^\n]*/g, "");
}

/**
 * Net EXECUTE state per grantee for a function, replaying GRANT/REVOKE
 * statements in migration order. A function's starting state is Postgres's
 * default: PUBLIC can execute it, and Supabase's default privileges also grant
 * anon, authenticated and service_role.
 */
function netExecute(name: string): Record<string, boolean> {
  const state: Record<string, boolean> = {
    public: true,
    anon: true,
    authenticated: true,
    service_role: true,
  };
  const stmt = new RegExp(
    `\\b(GRANT|REVOKE)\\s+(?:ALL(?:\\s+PRIVILEGES)?|EXECUTE)\\s+ON\\s+FUNCTION\\s+public\\.${name}\\s*\\([^)]*\\)\\s+(TO|FROM)\\s+([^;]+);`,
    "gi"
  );
  for (const { sql } of migrations) {
    for (const m of code(sql).matchAll(stmt)) {
      const grant = m[1].toUpperCase() === "GRANT";
      for (const who of m[3].split(",")) {
        state[who.trim().toLowerCase()] = grant;
      }
    }
  }
  return state;
}

const OWNER_CHECKED = ["create_bot_user", "update_bot_user", "delete_bot_user"] as const;
const ALL_BOT_RPCS = [...OWNER_CHECKED, "admin_delete_bot_user", "admin_update_bot_user"] as const;

describe("bot user RPCs check the caller, not the caller's word (card 23cecd8a)", () => {
  for (const name of OWNER_CHECKED) {
    describe(name, () => {
      const def = latestDefinition(name);

      it("has a definition in the migrations folder", () => {
        expect(def).not.toBeNull();
      });

      it("compares p_owner_id with auth.uid() in its latest definition", () => {
        const body = code(def!.body);
        expect(body, `latest definition is in ${def!.file}`).toMatch(
          /p_owner_id\s+IS\s+DISTINCT\s+FROM\s+auth\.uid\(\)|p_owner_id\s*(?:<>|!=)\s*auth\.uid\(\)/i
        );
        expect(body).toMatch(/auth\.uid\(\)\s+IS\s+NULL/i);
      });

      it("only exempts the service role from the check", () => {
        const body = code(def!.body);
        expect(body).toMatch(/auth\.role\(\)\s+IS\s+DISTINCT\s+FROM\s+'service_role'/i);
        expect(body).not.toMatch(/auth\.role\(\)\s*=\s*'(anon|authenticated)'/i);
      });

      it("pins search_path", () => {
        expect(def!.header).toMatch(/SET\s+search_path\s*(?:=|TO)\s*'?public'?/i);
      });
    });
  }

  it("create_bot_user lets an admin create platform-owned agents (admin-agents.ts)", () => {
    const body = code(latestDefinition("create_bot_user")!.body);
    expect(body).toContain(`'${VIBECODES_USER_ID}'`);
    expect(body).toMatch(/is_admin/);
  });

  for (const name of ALL_BOT_RPCS) {
    it(`${name}: anon and PUBLIC can't execute it; signed-in users and service role can`, () => {
      const state = netExecute(name);
      expect(state.anon).toBe(false);
      expect(state.public).toBe(false);
      expect(state.authenticated).toBe(true);
      expect(state.service_role).toBe(true);
    });
  }
});
