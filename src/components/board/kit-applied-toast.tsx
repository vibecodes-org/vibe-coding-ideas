"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";

export function KitAppliedToast() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const kitApplied = searchParams.get("kit_applied");

  useEffect(() => {
    if (!kitApplied) return;
    toast.success(`Kit applied — ${decodeURIComponent(kitApplied)}`);
    // Clean the URL
    const params = new URLSearchParams(searchParams.toString());
    params.delete("kit_applied");
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [kitApplied, searchParams, router, pathname]);

  return null;
}
