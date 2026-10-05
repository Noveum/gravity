"use client";
import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";

export interface DraftBuffer {
  text: string;
  version: number;
}
type Buffers = ReadonlyMap<string, DraftBuffer>;
interface DraftBufferActions {
  save: (id: string, buffer: DraftBuffer) => void;
  drop: (...ids: string[]) => void;
  clear: () => void;
}

const empty: Buffers = new Map();
const BuffersContext = createContext<Buffers>(empty);
const ActionsContext = createContext<DraftBufferActions | null>(null);

export function DraftBuffersProvider({ children }: { children: ReactNode }) {
  const [buffers, setBuffers] = useState<Buffers>(empty);
  const actions = useMemo<DraftBufferActions>(
    () => ({
      save: (id, buffer) =>
        setBuffers((current) => new Map(current).set(id, buffer)),
      drop: (...ids) =>
        setBuffers((current) => {
          if (!ids.some((id) => current.has(id))) return current;
          const next = new Map(current);
          for (const id of ids) next.delete(id);
          return next;
        }),
      clear: () => setBuffers((current) => (current.size ? empty : current)),
    }),
    [],
  );
  return (
    <ActionsContext.Provider value={actions}>
      <BuffersContext.Provider value={buffers}>
        {children}
      </BuffersContext.Provider>
    </ActionsContext.Provider>
  );
}

export function useDraftBufferActions() {
  const actions = useContext(ActionsContext);
  if (!actions) throw new Error("DRAFT_BUFFERS_MISSING");
  return actions;
}

export function useDraftBuffers() {
  return useContext(BuffersContext);
}
