import { resolve } from "node:path";

import { buildContext } from "./app/context.ts";
import { loadConfig } from "./config.ts";
import { loadEnvFile } from "./env.ts";
import { createHttpServer } from "./http/server.ts";

loadEnvFile(resolve(process.cwd(), ".env"), process.env);
const config = loadConfig(process.env);
const { ctx, close } = buildContext({ config });
const server = createHttpServer(ctx);

server.listen(config.port, () => {
  const payments = ctx.payments.name === "manual" ? "manual (no card is captured)" : "stripe";
  const ghl = ctx.ghl ? "configured" : "off";
  console.log(`Super Cleaning Bros listening on ${config.publicBaseUrl}`);
  console.log(`Payments: ${payments}. GoHighLevel: ${ghl}.`);
});

function shutdown(): void {
  server.close();
  close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
