"use client";

import { createContext, useContext } from "react";

const BotRolesContext = createContext<Record<string, string>>({});

export function BotRolesProvider({
  botRoles,
  children,
}: {
  botRoles: Record<string, string>;
  children: React.ReactNode;
}) {
  return (
    <BotRolesContext.Provider value={botRoles}>
      {children}
    </BotRolesContext.Provider>
  );
}

export function useBotRoles(): Record<string, string> {
  return useContext(BotRolesContext);
}
