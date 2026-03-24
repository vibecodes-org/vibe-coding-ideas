"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";

export function KitErrorToast() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const kitError = searchParams.get("kit_error");

  useEffect(() => {
    if (!kitError) return;
    toast.error(
      "Failed to apply kit. Your idea was created — you can apply a kit from the Workflows tab."
    );
    const params = new URLSearchParams(searchParams.toString());
    params.delete("kit_error");
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [kitError, searchParams, router, pathname]);

  return null;
}
