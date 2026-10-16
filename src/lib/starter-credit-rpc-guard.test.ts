// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Regression guard for board card 2ecca8e9: decrement_starter_credit is
 * SECURITY DEFINER, took the user to charge as an argument without comparing
 * it with auth.uid(), and EXECUTE was held by anon and PUBLIC. So anyone with
 * the public anon key could use up any user's starter AI credits.
 * grant_starter_credits had the same grants and no pinned search_path.
 *
 * Postgres permissions aren't reachable from Vitest, so this replays the
 * migrations folder in order and checks the definition and grants the folder
 * leaves in force (the last CREATE OR REPLACE of each function, and the net
 * GRANT/REVOKE sequence). The live behaviour is proven on the production schema
 * by the aborting DO-block dry run in the PR (see docs/notes/2ecca8e9.md).
 */

const MIGRATIONS_DIR = path.join(__dirname, "../../supabase/migrations");
const migrations = readdirSync(MIGRATIONS_DIR)
  .filter((f) => /^\d{5}_.*\.sql$/.test(f))
  .sort()
  .map((f) => ({ file: f, sql: readFileSync(path.join(MIGRATIONS_DIR, f), "utf8") }));

/** Strip `--` comments so a comment that mentions auth.uid() can't satisfy a check. */
function code(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

/** Header and body of the last `CREATE [OR REPLACE] FUNCTION public.<name>(` in the folder. */
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

/**
 * Net EXECUTE state per grantee for a function, replaying GRANT/REVOKE in
 * migration order. Starting state is Postgres's default (PUBLIC can execute)
 * plus Supabase's default privileges for anon, authenticated and service_role.
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

describe("starter credit RPCs check the caller (card 2ecca8e9)", () => {
  describe("decrement_starter_credit", () => {
    const def = latestDefinition("decrement_starter_credit");

    it("has a definition in the migrations folder", () => {
      expect(def).not.toBeNull();
    });

    it("only lets a caller charge themselves", () => {
      const body = code(def!.body);
      expect(body, `latest definition is in ${def!.file}`).toMatch(
        /p_user_id\s+IS\s+DISTINCT\s+FROM\s+auth\.uid\(\)|p_user_id\s*(?:<>|!=)\s*auth\.uid\(\)/i
      );
      expect(body).toMatch(/auth\.uid\(\)\s+IS\s+NULL/i);
    });

    it("checks the caller before touching any row", () => {
      const body = code(def!.body);
      const check = body.search(/p_user_id\s+IS\s+DISTINCT\s+FROM\s+auth\.uid\(\)/i);
      const bypass = body.search(/set_config\s*\(\s*'app\.trusted_bot_operation'/i);
      const update = body.search(/UPDATE\s+public\.users/i);
      expect(check).toBeGreaterThan(-1);
      expect(check).toBeLessThan(bypass);
      expect(check).toBeLessThan(update);
    });

    it("only exempts the service role from the check", () => {
      const body = code(def!.body);
      expect(body).toMatch(/auth\.role\(\)\s+IS\s+DISTINCT\s+FROM\s+'service_role'/i);
      expect(body).not.toMatch(/auth\.role\(\)\s*=\s*'(anon|authenticated)'/i);
    });

    it("still decrements only while credits remain", () => {
      const body = code(def!.body);
      expect(body).toMatch(/SET\s+ai_starter_credits\s*=\s*ai_starter_credits\s*-\s*1/i);
      expect(body).toMatch(/ai_starter_credits\s*>\s*0/);
    });
  });

  describe("grant_starter_credits", () => {
    const def = latestDefinition("grant_starter_credits");

    it("still requires a super admin", () => {
      expect(code(def!.body)).toMatch(/auth\.uid\(\)\s+AND\s+is_super_admin\s*=\s*true/i);
    });
  });

  for (const name of ["decrement_starter_credit", "grant_starter_credits"]) {
    it(`${name} pins search_path`, () => {
      expect(latestDefinition(name)!.header).toMatch(/SET\s+search_path\s*(?:=|TO)\s*'?public'?/i);
    });

    it(`${name}: anon and PUBLIC can't execute it; signed-in users and service role can`, () => {
      const state = netExecute(name);
      expect(state.anon).toBe(false);
      expect(state.public).toBe(false);
      expect(state.authenticated).toBe(true);
      expect(state.service_role).toBe(true);
    });
  }
});
