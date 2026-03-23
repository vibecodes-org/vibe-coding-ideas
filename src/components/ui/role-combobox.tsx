"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Check } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { BOT_ROLE_TEMPLATES } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";

export interface RoleSuggestion {
  role: string;
  source: "pool" | "mine" | "standard";
  agentName?: string;
}

interface RoleComboboxProps {
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  placeholder?: string;
  ideaId?: string;
  compact?: boolean;
  showHelperText?: boolean;
  helperText?: string;
  className?: string;
  /** Pre-fetched pool roles to avoid redundant queries when multiple comboboxes share the same idea */
  poolRoles?: RoleSuggestion[];
  /** Pre-fetched user roles to avoid redundant queries */
  userRoles?: RoleSuggestion[];
}

const STANDARD_ROLES: RoleSuggestion[] = BOT_ROLE_TEMPLATES.map((t) => ({
  role: t.role,
  source: "standard" as const,
}));

export function useRoleSuggestions(ideaId?: string) {
  const [poolRoles, setPoolRoles] = useState<RoleSuggestion[]>([]);
  const [userRoles, setUserRoles] = useState<RoleSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    async function fetch() {
      setLoading(true);
      try {
        // Fetch user's own agent roles
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user || cancelled) return;

        const { data: myBots } = await supabase
          .from("bot_profiles")
          .select("role")
          .eq("owner_id", user.id)
          .not("role", "is", null);

        if (!cancelled && myBots) {
          const seen = new Set<string>();
          setUserRoles(
            myBots
              .filter((b) => {
                const r = b.role?.trim().toLowerCase();
                if (!r || seen.has(r)) return false;
                seen.add(r);
                return true;
              })
              .map((b) => ({
                role: b.role!,
                source: "mine" as const,
              }))
          );
        }

        // Fetch idea pool agent roles if ideaId provided
        if (ideaId) {
          const { data: poolBots } = await supabase
            .from("idea_agents")
            .select("bot:bot_profiles!idea_agents_bot_id_fkey(role, name)")
            .eq("idea_id", ideaId);

          if (!cancelled && poolBots) {
            const seen = new Set<string>();
            setPoolRoles(
              poolBots
                .filter((p) => {
                  const role = (p.bot as { role: string | null; name: string })
                    ?.role?.trim()
                    .toLowerCase();
                  if (!role || seen.has(role)) return false;
                  seen.add(role);
                  return true;
                })
                .map((p) => {
                  const bot = p.bot as { role: string | null; name: string };
                  return {
                    role: bot.role!,
                    source: "pool" as const,
                    agentName: bot.name,
                  };
                })
            );
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetch();
    return () => {
      cancelled = true;
    };
  }, [ideaId]);

  return { poolRoles, userRoles, loading };
}

function buildSuggestions(
  poolRoles: RoleSuggestion[],
  userRoles: RoleSuggestion[],
  compact: boolean,
  filterText: string = ""
): {
  pool: RoleSuggestion[];
  mine: RoleSuggestion[];
  standard: RoleSuggestion[];
} {
  const seenLower = new Set<string>();
  const query = filterText.trim().toLowerCase();

  const matchesFilter = (role: string) =>
    !query || role.trim().toLowerCase().includes(query);

  const pool = poolRoles.filter((r) => {
    const key = r.role.trim().toLowerCase();
    if (seenLower.has(key)) return false;
    seenLower.add(key);
    return matchesFilter(r.role);
  });

  // Compact variant (template steps) skips "My Agents" group
  const mine = compact
    ? []
    : userRoles.filter((r) => {
        const key = r.role.trim().toLowerCase();
        if (seenLower.has(key)) return false;
        seenLower.add(key);
        return matchesFilter(r.role);
      });

  const standard = STANDARD_ROLES.filter((r) => {
    const key = r.role.trim().toLowerCase();
    if (seenLower.has(key)) return false;
    seenLower.add(key);
    return matchesFilter(r.role);
  });

  return { pool, mine, standard };
}

export function RoleCombobox({
  value,
  onChange,
  maxLength = 50,
  placeholder = "e.g. Developer",
  ideaId,
  compact = false,
  showHelperText = false,
  helperText = "Used to auto-assign workflow steps. Use short roles like \u201cDeveloper\u201d or \u201cQA\u201d.",
  className,
  poolRoles: externalPoolRoles,
  userRoles: externalUserRoles,
}: RoleComboboxProps) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Use external data if provided, otherwise fetch internally
  const internal = useRoleSuggestions(
    externalPoolRoles !== undefined ? undefined : ideaId
  );
  const poolRoles = externalPoolRoles ?? internal.poolRoles;
  const userRoles = externalUserRoles ?? internal.userRoles;

  const { pool, mine, standard } = buildSuggestions(
    poolRoles,
    userRoles,
    compact,
    value
  );

  const hasAnyGroup = pool.length > 0 || mine.length > 0 || standard.length > 0;

  const handleSelect = useCallback(
    (selectedRole: string) => {
      onChange(selectedRole);
      setOpen(false);
      // Return focus to input after selection
      setTimeout(() => inputRef.current?.focus(), 0);
    },
    [onChange]
  );

  return (
    <div className={cn("relative", className)}>
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
        <PopoverPrimitive.Anchor asChild>
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setOpen(true)}
            placeholder={placeholder}
            maxLength={maxLength}
            className={cn(compact && "h-7 text-xs")}
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            autoComplete="off"
          />
        </PopoverPrimitive.Anchor>
        {hasAnyGroup && (
          <PopoverPrimitive.Content
            className={cn(
              "bg-popover text-popover-foreground z-[100] rounded-md border p-0 shadow-md outline-hidden",
              "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
              compact ? "w-[200px]" : "w-[var(--radix-popover-trigger-width)]"
            )}
            align="start"
            sideOffset={4}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onInteractOutside={() => setOpen(false)}
          >
            <Command shouldFilter={false}>
              <CommandList>
                <CommandEmpty className="py-3 text-center text-xs text-muted-foreground">
                  No matching roles. Type to use a custom role.
                </CommandEmpty>
                {pool.length > 0 && (
                  <CommandGroup heading={compact ? "Idea Agents" : "Idea Pool"}>
                    {pool.map((r) => (
                      <CommandItem
                        key={`pool-${r.role}`}
                        value={r.role}
                        onSelect={handleSelect}
                        className={cn(compact && "text-xs py-1")}
                      >
                        <span className="flex-1 truncate">{r.role}</span>
                        {r.agentName && !compact && (
                          <span className="ml-auto shrink-0 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] text-blue-400">
                            {r.agentName}
                          </span>
                        )}
                        {value.toLowerCase() === r.role.toLowerCase() && (
                          <Check className="h-3 w-3 shrink-0 text-green-400" />
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                {mine.length > 0 && (
                  <CommandGroup heading="My Agents">
                    {mine.map((r) => (
                      <CommandItem
                        key={`mine-${r.role}`}
                        value={r.role}
                        onSelect={handleSelect}
                      >
                        <span className="flex-1 truncate">{r.role}</span>
                        <span className="ml-auto shrink-0 rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-400">
                          mine
                        </span>
                        {value.toLowerCase() === r.role.toLowerCase() && (
                          <Check className="h-3 w-3 shrink-0 text-green-400" />
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                {standard.length > 0 && (
                  <CommandGroup heading={compact ? "Standard" : "Standard Roles"}>
                    {standard.map((r) => (
                      <CommandItem
                        key={`standard-${r.role}`}
                        value={r.role}
                        onSelect={handleSelect}
                        className={cn(compact && "text-xs py-1")}
                      >
                        <span className="flex-1 truncate">{r.role}</span>
                        {value.toLowerCase() === r.role.toLowerCase() && (
                          <Check className="h-3 w-3 shrink-0 text-green-400" />
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverPrimitive.Content>
        )}
      </PopoverPrimitive.Root>
      {showHelperText && (
        <p className="mt-1 text-[10px] text-muted-foreground">{helperText}</p>
      )}
    </div>
  );
}
