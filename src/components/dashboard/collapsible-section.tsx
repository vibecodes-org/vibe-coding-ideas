"use client";

import { useState, useEffect, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface CollapsibleSectionProps {
  sectionId: string;
  title: string;
  icon: ReactNode;
  count?: number;
  children: ReactNode;
  headerRight?: ReactNode;
}

export function CollapsibleSection({
  sectionId,
  title,
  icon,
  count,
  children,
  headerRight,
}: CollapsibleSectionProps) {
  const storageKey = `dashboard-collapsed-${sectionId}`;
  const [isOpen, setIsOpen] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate open/closed state from localStorage on mount (client-only API)
      if (stored === "false") setIsOpen(false);
    } catch {
      // localStorage unavailable — stay expanded
    }
    setMounted(true);
  }, [storageKey]);

  const toggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    try {
      localStorage.setItem(storageKey, String(next));
    } catch {
      // localStorage unavailable
    }
  };

  const header = (
    <div className="flex items-center justify-between">
      <button
        onClick={toggle}
        className="flex items-center gap-1.5 sm:gap-2 text-sm sm:text-lg font-semibold hover:text-muted-foreground transition-colors"
        aria-expanded={isOpen}
        aria-controls={`section-${sectionId}`}
      >
        {mounted ? (
          isOpen ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="hidden sm:inline">{icon}</span>
        {title}
        {count !== undefined && count > 0 && (
          <Badge variant="secondary" className="text-[10px] font-normal">
            {count}
          </Badge>
        )}
      </button>
      {headerRight}
    </div>
  );

  return (
    <Card data-testid={`section-${sectionId}`} className="py-3 gap-3 sm:py-6 sm:gap-6 overflow-hidden">
      <CardHeader className="px-4 sm:px-6">
        {header}
      </CardHeader>
      {(mounted ? isOpen : true) && (
        <CardContent id={`section-${sectionId}`} className="px-4 sm:px-6">
          {children}
        </CardContent>
      )}
    </Card>
  );
}
