"use client";

import { useEffect } from "react";
import { useSearchParams, usePathname } from "next/navigation";
import { toast } from "sonner";

export function KitAppliedToast() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const kitApplied = searchParams.get("kit_applied");

  useEffect(() => {
    if (!kitApplied) return;
    toast.success(`Kit applied — ${decodeURIComponent(kitApplied)}`);

    // Strip ?kit_applied from the URL WITHOUT a router navigation. The board page
    // is force-dynamic, so router.replace() re-runs the whole server component and
    // refetches every board query — a second full render of the heavy board right
    // after creation (a big chunk of the slow post-kit-apply paint). The native
    // history.replaceState updates the URL bar with no refetch/re-render.
    const params = new URLSearchParams(window.location.search);
    params.delete("kit_applied");
    const qs = params.toString();
    window.history.replaceState(null, "", `${pathname}${qs ? `?${qs}` : ""}`);
  }, [kitApplied, pathname]);

  return null;
}
