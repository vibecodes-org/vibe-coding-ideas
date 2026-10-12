// The Supabase side of the layout conversion (task 472d5672): reads and writes
// bot_profiles and bot_profile_prompt_backups with the service-role client.
// Kept apart from agent-layout-conversion.ts so that module stays pure.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { AgentRow, BackupRow, ConversionStore, NewBackup } from "./agent-layout-conversion";

const PAGE_SIZE = 500;
/** Far above the real count (~170 agents); stops a paging bug from looping forever. */
const MAX_PAGES = 50;

type Client = SupabaseClient<Database>;

export function createSupabaseConversionStore(client: Client): ConversionStore {
  return {
    async listAgents() {
      const rows: (AgentRow & { name: string | null })[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const { data, error } = await client
          .from("bot_profiles")
          .select("id, owner_id, name, role, system_prompt, updated_at")
          .order("id", { ascending: true })
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
        if (error) throw new Error(`Reading agents failed: ${error.message}`);
        rows.push(...(data ?? []));
        if (!data || data.length < PAGE_SIZE) return rows;
      }
      throw new Error("Reading agents did not finish within the page limit");
    },

    async listBackups(reason: string) {
      const rows: BackupRow[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const { data, error } = await client
          .from("bot_profile_prompt_backups")
          .select("bot_id, system_prompt, backed_up_at")
          .eq("reason", reason)
          .order("backed_up_at", { ascending: true })
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
        if (error) throw new Error(`Reading backups failed: ${error.message}`);
        rows.push(...(data ?? []));
        if (!data || data.length < PAGE_SIZE) return rows;
      }
      throw new Error("Reading backups did not finish within the page limit");
    },

    async insertBackup(backup: NewBackup) {
      const { error } = await client.from("bot_profile_prompt_backups").insert(backup);
      if (error) throw new Error(`Writing a backup for ${backup.bot_id} failed: ${error.message}`);
    },

    async setPrompt(id: string, systemPrompt: string | null, expectedUpdatedAt: string) {
      const { data, error } = await client
        .from("bot_profiles")
        .update({ system_prompt: systemPrompt })
        .eq("id", id)
        .eq("updated_at", expectedUpdatedAt)
        .select("id");
      if (error) throw new Error(`Updating ${id} failed: ${error.message}`);
      return (data ?? []).length === 1;
    },
  };
}
