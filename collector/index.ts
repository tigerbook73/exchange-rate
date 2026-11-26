import { dispatchAlerts } from "../src/lib/server/alert-store";
import { collectMinute } from "../src/lib/server/server-collector";

export default {
  async scheduled(controller: ScheduledController, env: CollectorEnv) {
    await collectMinute(
      env.DB,
      undefined,
      controller.scheduledTime,
      Boolean(env.PUSH_VAPID_KEYS),
    );
    if (env.PUSH_VAPID_KEYS) {
      try {
        await dispatchAlerts(env.DB, env.PUSH_VAPID_KEYS);
      } catch {
        console.error(
          JSON.stringify({ task: "push", error: "dispatch-failed" }),
        );
      }
    }
  },
  fetch() {
    // No public collection or mutation endpoint. Local scheduled testing is provided by Wrangler.
    return new Response("Scheduled collector", { status: 404 });
  },
} satisfies ExportedHandler<CollectorEnv>;
