import { toast } from "sonner";
import { describePropagation, type PropagationSummary } from "@/lib/template-propagation-message";

/** Show the result of saving a template: green when all went through, amber (stays) when not. */
export function showPropagationToast(base: string, report: PropagationSummary | null | undefined) {
  const m = describePropagation(base, report);
  if (m.level === "success") {
    toast.success(m.message);
    return;
  }
  toast.warning(m.message, { description: m.details.join(" "), duration: Infinity, closeButton: true });
}
