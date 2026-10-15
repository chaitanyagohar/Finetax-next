"use client";

import { createContext, useContext } from "react";
import type { SessionUser } from "./navConfig";

const UserContext = createContext<SessionUser | null>(null);

export const UserProvider = UserContext.Provider;

/** Access the signed-in user anywhere in the app without another database call. */
export function useCurrentUser(): SessionUser | null {
  return useContext(UserContext);
}