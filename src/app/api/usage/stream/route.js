import { statsEmitter, getActiveRequests } from "@/lib/usageDb";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();
  const state = { closed: false, keepalive: null, send: null };

  const stream = new ReadableStream({
    async start(controller) {
      // Real-time lightweight push: activeRequests, recentRequests, errorProvider, pending.
      // Full stats are fetched on-demand by the client via REST (/api/usage/stats?period=...).
      state.send = async () => {
        if (state.closed) return;
        try {
          const { activeRequests, recentRequests, errorProvider } = await getActiveRequests();
          const quickStats = {
            activeRequests,
            recentRequests,
            errorProvider,
            pending: global._pendingRequests || { byModel: {}, byAccount: {} },
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(quickStats)}\n\n`));
        } catch {
          state.closed = true;
          statsEmitter.off("update", state.send);
          statsEmitter.off("pending", state.send);
          clearInterval(state.keepalive);
        }
      };

      await state.send();

      statsEmitter.on("update", state.send);
      statsEmitter.on("pending", state.send);

      state.keepalive = setInterval(() => {
        if (state.closed) { clearInterval(state.keepalive); return; }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          state.closed = true;
          clearInterval(state.keepalive);
        }
      }, 25000);
    },

    cancel() {
      state.closed = true;
      statsEmitter.off("update", state.send);
      statsEmitter.off("pending", state.send);
      clearInterval(state.keepalive);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
