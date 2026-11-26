"use client";

import { toast } from "sonner";
import { logger } from "@/lib/logger";
import styles from "./aurora.module.css";

export function CopyCommand({ command }: { command: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      toast.success("Copied");
    } catch (err) {
      logger.warn("Copy install command failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      toast.error("Couldn't copy. Select the command and copy it by hand.");
    }
  }

  return (
    <div className={styles.cmd}>
      <i aria-hidden="true">$</i>
      <code>{command}</code>
      <button type="button" className={styles.copy} onClick={copy}>
        Copy
      </button>
    </div>
  );
}
