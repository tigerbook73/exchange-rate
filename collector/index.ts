import { collectMinute } from "../src/lib/server/server-collector";

export default {
  async scheduled(controller: ScheduledController, env: CollectorEnv) {
    await collectMinute(env.DB, undefined, controller.scheduledTime);
  },
  fetch() {
    // No public collection or mutation endpoint. Local scheduled testing is provided by Wrangler.
    return new Response("Scheduled collector", { status: 404 });
  },
} satisfies ExportedHandler<CollectorEnv>;
