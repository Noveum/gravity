"use client";
import type { ClientCompanyContext, ClientContext } from "@crm/core/dto";
import { useEffect, useState } from "react";
import { errorText, requestJson } from "../client-api";
import { useCrm } from "./crm-context";
import { isAccessError } from "./use-live-snapshot";

const recordErrors = ["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"];
const cacheLimit = 50;

function contextUrl(organizationId: string, relationshipId: string) {
  return `/api/crm?operation=context&organizationId=${organizationId}&relationshipId=${relationshipId}`;
}

function remember(
  cache: Map<string, ClientContext>,
  key: string,
  context: ClientContext,
) {
  cache.set(key, context);
  if (cache.size > cacheLimit) cache.delete(cache.keys().next().value ?? "");
}

export function usePersonContext(relationshipId: string) {
  const { organizationId, sourceData, notify, contextCache } = useCrm();
  const asOf = sourceData?.asOf;
  const scope = `${organizationId}/${relationshipId}`;
  const [loaded, setLoaded] = useState<{
    scope: string;
    context: ClientContext | null;
    missing: boolean;
  }>({ scope: "", context: null, missing: false });
  useEffect(() => {
    if (!relationshipId || !organizationId || !asOf) return;
    const controller = new AbortController();
    requestJson<ClientContext>(contextUrl(organizationId, relationshipId), {
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        remember(contextCache.current, `${scope}/${asOf}`, result);
        setLoaded({ scope, context: result, missing: false });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        notify(errorText(error), "danger");
        if (isAccessError(error, recordErrors)) {
          contextCache.current.clear();
          setLoaded({ scope, context: null, missing: true });
        }
      });
    return () => controller.abort();
  }, [scope, relationshipId, organizationId, asOf, notify, contextCache]);
  if (!relationshipId) return { context: null, missing: false };
  if (loaded.scope === scope)
    return { context: loaded.context, missing: loaded.missing };
  return {
    context: contextCache.current.get(`${scope}/${asOf}`) ?? null,
    missing: false,
  };
}

export function useWarmContext() {
  const { organizationId, sourceData, contextCache } = useCrm();
  return (relationshipId: string) => {
    if (!relationshipId || !sourceData?.asOf) return;
    const key = `${organizationId}/${relationshipId}/${sourceData.asOf}`;
    if (contextCache.current.has(key)) return;
    void requestJson<ClientContext>(contextUrl(organizationId, relationshipId))
      .then((result) => remember(contextCache.current, key, result))
      .catch(() => {});
  };
}

export function useCompanyContext(companyId: string) {
  const { organizationId, sourceData, notify } = useCrm();
  const asOf = sourceData?.asOf;
  const scope = `${organizationId}/${companyId}`;
  const [loaded, setLoaded] = useState<{
    scope: string;
    context: ClientCompanyContext | null;
    missing: boolean;
  }>({ scope: "", context: null, missing: false });
  useEffect(() => {
    if (!companyId || !organizationId || !asOf) return;
    const controller = new AbortController();
    requestJson<ClientCompanyContext>(
      `/api/crm?operation=company&organizationId=${organizationId}&companyId=${companyId}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted)
          setLoaded({ scope, context: result, missing: false });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        notify(errorText(error), "danger");
        if (isAccessError(error, recordErrors))
          setLoaded({ scope, context: null, missing: true });
      });
    return () => controller.abort();
  }, [scope, companyId, organizationId, asOf, notify]);
  return loaded.scope === scope
    ? { context: loaded.context, missing: loaded.missing }
    : { context: null, missing: false };
}

export function useArchivedPersonContext(personId: string) {
  const { organizationId, sourceData, notify } = useCrm();
  const asOf = sourceData?.asOf;
  const scope = `${organizationId}/${personId}`;
  const [loaded, setLoaded] = useState<{
    scope: string;
    context: ClientContext | null;
    missing: boolean;
  }>({ scope: "", context: null, missing: false });
  useEffect(() => {
    if (!personId || !organizationId || !asOf) return;
    const controller = new AbortController();
    requestJson<ClientContext>(
      `/api/crm?operation=person&organizationId=${organizationId}&personId=${personId}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted)
          setLoaded({ scope, context: result, missing: false });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        notify(errorText(error), "danger");
        if (isAccessError(error, recordErrors))
          setLoaded({ scope, context: null, missing: true });
      });
    return () => controller.abort();
  }, [scope, personId, organizationId, asOf, notify]);
  return loaded.scope === scope
    ? { context: loaded.context, missing: loaded.missing }
    : { context: null, missing: false };
}
