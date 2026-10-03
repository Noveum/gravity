"use client";
import type { ClientSnapshot } from "@crm/core/dto";
import { useEffect, useState } from "react";
import { errorText, requestJson } from "./client-api";

// A filtered list is not a complete set of people or assignees for another product.
// Fetch the current user's entire authorized organization scope before allowing submission.
export function useDialogSnapshot(
  initial: ClientSnapshot,
  organizationId: string,
) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt intentionally restarts an aborted or failed scope request.
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    requestJson<ClientSnapshot>(
      `/api/crm?organizationId=${encodeURIComponent(organizationId)}`,
      { signal: abort.signal },
    )
      .then((snapshot) => {
        if (!abort.signal.aborted) setData(snapshot);
      })
      .catch((cause) => {
        if (!abort.signal.aborted) setError(errorText(cause));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [organizationId, attempt]);
  return {
    data,
    loading,
    error,
    retry: () => setAttempt((value) => value + 1),
  };
}
