"use client";

import { useTransition } from "react";
import Link from "next/link";
import { Check, X, Clock } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { respondToRequest } from "@/actions/collaborators";
import { getInitials } from "@/lib/utils";
import type { CollaborationRequestWithRequester } from "@/types";

interface PendingRequestsProps {
  ideaId: string;
  requests: CollaborationRequestWithRequester[];
}

function RequestRow({ request, ideaId }: { request: CollaborationRequestWithRequester; ideaId: string }) {
  const [isPending, startTransition] = useTransition();

  const initials = getInitials(request.requester.full_name);

  const handleRespond = (accept: boolean) => {
    startTransition(async () => {
      try {
        await respondToRequest(request.id, ideaId, accept);
        toast.success(accept ? "Request accepted" : "Request declined");
      } catch {
        toast.error("Failed to respond to request");
      }
    });
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
      <Link href={`/profile/${request.requester_id}`} className="flex items-center gap-2 min-w-0 flex-1">
        <Avatar className="h-6 w-6 shrink-0">
          <AvatarImage src={request.requester.avatar_url ?? undefined} />
          <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
        </Avatar>
        <span className="text-sm font-medium truncate">{request.requester.full_name ?? "Anonymous"}</span>
      </Link>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950"
          onClick={() => handleRespond(true)}
          disabled={isPending}
        >
          <Check className="h-4 w-4" />
          <span className="sr-only">Accept</span>
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
          onClick={() => handleRespond(false)}
          disabled={isPending}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Decline</span>
        </Button>
      </div>
    </div>
  );
}

export function PendingRequests({ ideaId, requests }: PendingRequestsProps) {
  if (requests.length === 0) return null;

  return (
    <div className="mt-4">
      <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <Clock className="h-4 w-4" />
        Pending Requests ({requests.length})
      </h4>
      <div className="flex flex-wrap gap-2">
        {requests.map((request) => (
          <RequestRow key={request.id} request={request} ideaId={ideaId} />
        ))}
      </div>
    </div>
  );
}
