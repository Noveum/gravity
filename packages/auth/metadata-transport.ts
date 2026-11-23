import { lookup } from "node:dns/promises";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { isPublicRoutableHost } from "@better-auth/core/utils/host";
import { isWorkersRuntime } from "../database/client";

// The Node transport pins the checked address on its own socket. Workers has
// no such socket and refuses redirect: "error", so there every DNS answer is
// checked and the redirect comes back unfollowed for the plugin to reject. The
// address is not pinned; a Worker has no private network to be steered into.
const workersTransport: typeof fetchClientMetadataResource = async (
  input,
  init,
) => {
  const request = new Request(input, { ...init, redirect: "manual" });
  const url = new URL(request.url);
  if (url.protocol !== "https:") throw new TypeError("METADATA_URL_INVALID");
  const answers = await lookup(url.hostname, { all: true, verbatim: true });
  if (
    !answers.length ||
    answers.some((answer) => !isPublicRoutableHost(answer.address))
  )
    throw new TypeError("METADATA_HOST_NOT_PUBLIC");
  return fetch(request);
};

export const metadataTransport = isWorkersRuntime
  ? workersTransport
  : fetchClientMetadataResource;
