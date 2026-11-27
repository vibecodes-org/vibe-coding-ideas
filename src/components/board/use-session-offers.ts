"use client";

// The "next card" offers for this user's terminal sessions (card 7c728159).
// The board writes one row per session when a call from that session finishes
// a card's whole workflow (card e6a612b8); this hook reads
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
// A missed live event is caught by the next read, so this is the longest a bar
// can stay hidden while the tab is open and nothing else prompts a re-read.
// 45s: cheap (one small filtered read) and short enough to feel prompt.
const POLL_MS = 45_000;

export function useSessionOffers(): {
  offers: Map<string, SessionOffer>;
  setStatus: (sid: string, status: OfferStatus) => Promise<void>;
} {
  const [offers, setOffers] = useState<Map<string, SessionOffer>>(new Map());
  const offersRef = useRef(offers);
  useEffect(() => {
    offersRef.current = offers;
  }, [offers]);
  // Answers the person just gave that are still being saved. A re-read must not
  // bring a row back (or undo its new status) while its save is in flight.
  const pendingRef = useRef(new Map<string, OfferStatus>());

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let currentUserId: string | null = null;
    let loadSeq = 0;

    const apply = (row: SessionOffer) => {
      setOffers((prev) => {
        const next = new Map(prev);
        if (row.status === "dismissed") next.delete(row.sid);
        else next.set(row.sid, row);
        return next;
      });
    };

    const load = async (userId: string) => {
      const seq = ++loadSeq;
      const since = new Date(Date.now() - RECENT_MS).toISOString();
      const { data, error } = await supabase
        .from("terminal_session_offers")
        .select("*")
        .eq("user_id", userId)
        .in("status", ["offered", "started"])
        .gte("updated_at", since);
      if (cancelled || seq !== loadSeq) return;
      if (error) {
        logger.warn("Could not read terminal session offers", { error: error.message });
        return;
      }
      const next = new Map((data ?? []).map((r) => [r.sid, r as SessionOffer]));
      for (const [sid, status] of pendingRef.current) {
        if (status === "dismissed") next.delete(sid);
        else {
          const row = next.get(sid);
          if (row) next.set(sid, { ...row, status });
        }
      }
      setOffers(next);
    };

    const reload = () => {
      if (currentUserId) void load(currentUserId);
    };

    const connect = async () => {
      const { data } = await supabase.auth.getUser();
      const userId = data.user?.id;
      if (cancelled || !userId) return;
      currentUserId = userId;
      await load(userId);
      if (cancelled) return;
      const mine = supabase
        .channel(`terminal-offers-${userId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "terminal_session_offers", filter: `user_id=eq.${userId}` },
          (payload) => {
            // Rows are never deleted by the app: withdrawing or dismissing sets
            // status "dismissed", because delete events can't pass a filtered feed.
            apply(payload.new as SessionOffer);
          }
        );
      channel = mine;
      mine.subscribe((status) => {
          // Ignore events from a feed we already replaced or closed ourselves.
          if (cancelled || channel !== mine) return;
          // Events sent while the feed was down are lost: read again.
          if (status === "SUBSCRIBED") reload();
          if (status === "TIMED_OUT" || status === "CHANNEL_ERROR" || status === "CLOSED") {
            logger.warn("Terminal offers realtime dropped, retrying", { status });
            if (retry) clearTimeout(retry);
            retry = setTimeout(() => {
              const old = channel;
              channel = null;
              if (old) void old.unsubscribe();
              void connect().catch(() => {});
            }, RETRY_MS);
          }
        });
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    const poll = setInterval(reload, POLL_MS);

    void connect().catch((err) => {
      logger.warn("Terminal offers could not start", { error: err instanceof Error ? err.message : String(err) });
    });

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      const old = channel;
      channel = null;
      if (old) void old.unsubscribe();
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
    pendingRef.current.set(sid, status);
    const { error } = await supabase
      .from("terminal_session_offers")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("sid", sid)
      .select("sid")
      .maybeSingle();
    pendingRef.current.delete(sid);
    if (error) {
      logger.warn("Could not save the answer to a next-card offer", { error: error.message });
      toast.error("Couldn't save that. Try again.");
      if (before) setOffers((prev) => new Map(prev).set(sid, before));
    }
  }, []);

  return { offers, setStatus };
}
