import { currentPrincipal } from "@crm/auth/server";
import { subscribeChanges } from "@crm/core/changes";
import { CrmService } from "@crm/core/crm";
import { errorResponse } from "@crm/core/http";
import { DomainError } from "@crm/core/policy";
import { getDatabase } from "@crm/database/client";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;
export async function GET(request: Request) {
  try {
    const organizationId = z
      .uuid()
      .parse(new URL(request.url).searchParams.get("organizationId"));
    const service = new CrmService(await getDatabase());
    let revision = await service.revision(
      await currentPrincipal(request.headers),
      organizationId,
    );
    const encoder = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false,
          checking = false;
        const send = (event: string, value: unknown) => {
          if (!closed)
            controller.enqueue(
              encoder.encode(
                `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`,
              ),
            );
        };
        const close = () => {
          if (closed) return;
          closed = true;
          cleanup();
          controller.close();
        };
        const check = async () => {
          if (closed || checking) return;
          checking = true;
          try {
            const current = await service.revision(
              await currentPrincipal(request.headers),
              organizationId,
            );
            if (closed) return;
            if (current !== revision) {
              revision = current;
              send("revision", { revision });
            } else controller.enqueue(encoder.encode(": heartbeat\n\n"));
          } catch (error) {
            send(
              error instanceof DomainError && [401, 403].includes(error.status)
                ? "access-changed"
                : "unavailable",
              {},
            );
            close();
          } finally {
            checking = false;
          }
        };
        const unsubscribe = subscribeChanges(organizationId, () => {
          void check();
        });
        // One-second reconciliation also sees writes from another runtime or worker.
        const interval = setInterval(() => {
          void check();
        }, 1000);
        const deadline = setTimeout(close, 25000);
        cleanup = () => {
          closed = true;
          unsubscribe();
          clearInterval(interval);
          clearTimeout(deadline);
          request.signal.removeEventListener("abort", close);
        };
        request.signal.addEventListener("abort", close, { once: true });
        controller.enqueue(encoder.encode("retry: 1000\n\n"));
        send("revision", { revision });
        if (request.signal.aborted) close();
      },
      cancel() {
        cleanup();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "private, no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
