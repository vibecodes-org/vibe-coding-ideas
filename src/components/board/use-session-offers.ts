"use client";

// The "next card" offers for this user's terminal sessions (card 7c728159).
// A session writes one row through the offer_next_card tool; this hook reads
// them and keeps them live. Only the person's own rows are visible (row-level
// security), and an offer nobody answered in 48 hours is ignored.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { logger } from "@/lib/logger";
import type { Database } from "@/types/database";

export type SessionOffer = Database["public"]["Tables"]["terminal_session_offers"]["Row"];
export type OfferStatus = SessionOffer["status"];

const RECENT_MS = 48 * 60 * 60 * 1000;
const RETRY_MS = 5000;

export function useSessionOffers(): {
  offers: Map<string, SessionOffer>;
  setStatus: (sid: string, status: OfferStatus) => Promise<void>;
} {
  const [offers, setOffers] = useState<Map<string, SessionOffer>>(new Map());
  const offersRef = useRef(offers);
  useEffect(() => {
    offersRef.current = offers;
  }, [offers]);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const apply = (row: SessionOffer) => {
      setOffers((prev) => {
        const next = new Map(prev);
        if (row.status === "dismissed") next.delete(row.sid);
        else next.set(row.sid, row);
        return next;
      });
    };

    const load = async (userId: string) => {
      const since = new Date(Date.now() - RECENT_MS).toISOString();
      const { data, error } = await supabase
        .from("terminal_session_offers")
        .select("*")
        .eq("user_id", userId)
        .in("status", ["offered", "started"])
        .gte("updated_at", since);
      if (cancelled) return;
      if (error) {
        logger.warn("Could not read terminal session offers", { error: error.message });
        return;
      }
      setOffers(new Map((data ?? []).map((r) => [r.sid, r as SessionOffer])));
    };

    const connect = async () => {
      const { data } = await supabase.auth.getUser();
      const userId = data.user?.id;
      if (cancelled || !userId) return;
      await load(userId);
      if (cancelled) return;
      channel = supabase
        .channel(`terminal-offers-${userId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "terminal_session_offers", filter: `user_id=eq.${userId}` },
          (payload) => {
            if (payload.eventType === "DELETE") {
              const sid = (payload.old as { sid?: string }).sid;
              if (sid) {
                setOffers((prev) => {
                  const next = new Map(prev);
                  next.delete(sid);
                  return next;
                });
              }
              return;
            }
            apply(payload.new as SessionOffer);
          }
        )
        .subscribe((status) => {
          if (cancelled) return;
          if (status === "TIMED_OUT" || status === "CHANNEL_ERROR") {
            logger.warn("Terminal offers realtime dropped, retrying", { status });
            if (retry) clearTimeout(retry);
            retry = setTimeout(() => {
              if (channel) void channel.unsubscribe();
              channel = null;
              void connect();
            }, RETRY_MS);
          }
        });
    };

    void connect().catch((err) => {
      logger.warn("Terminal offers could not start", { error: err instanceof Error ? err.message : String(err) });
    });

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      if (channel) void channel.unsubscribe();
    };
  }, []);

  const setStatus = useCallback(async (sid: string, status: OfferStatus) => {
    const before = offersRef.current.get(sid);
    // Show the answer at once; put the row back if the save fails.
    setOffers((prev) => {
      const next = new Map(prev);
      const row = next.get(sid);
      if (!row) return prev;
      if (status === "dismissed") next.delete(sid);
      else next.set(sid, { ...row, status });
      return next;
    });
    const supabase = createClient();
    const { error } = await supabase
      .from("terminal_session_offers")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("sid", sid)
      .select("sid")
      .maybeSingle();
    if (error) {
      logger.warn("Could not save the answer to a next-card offer", { error: error.message });
      toast.error("Couldn't save that. Try again.");
      if (before) setOffers((prev) => new Map(prev).set(sid, before));
    }
  }, []);

  return { offers, setStatus };
}
