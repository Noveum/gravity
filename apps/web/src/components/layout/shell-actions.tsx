'use client';

import { createContext, useContext } from 'react';

export const ShellActionsContext = createContext<{ readonly openNavigation: () => void } | null>(
  null,
);
export const useShellActions = () => useContext(ShellActionsContext);
