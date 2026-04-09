#!/usr/bin/env npx tsx
/**
 * Debug script to test Discord bridge connectivity.
 * Logs all events and checks channel access.
 */
import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
} from "discord.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const TARGET_CHANNEL = "1491623782807244880";

// Load bot token
const envFile = join(homedir(), ".claude", "channels", "discord", ".env");
let token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  const content = readFileSync(envFile, "utf-8");
  const match = content.match(/^DISCORD_BOT_TOKEN=(.+)$/m);
  if (match) token = match[1].trim();
}
if (!token) { console.error("No token"); process.exit(1); }

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.on(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user?.tag}`);
  console.log(`Guilds: ${client.guilds.cache.map(g => `${g.name} (${g.id})`).join(", ")}`);

  // Check if we can see the target channel
  const channel = client.channels.cache.get(TARGET_CHANNEL);
  console.log(`Target channel ${TARGET_CHANNEL}: ${channel ? `found (type: ${channel.type})` : "NOT FOUND in cache"}`);

  // List all channels we can see
  console.log(`\nAll channels (${client.channels.cache.size}):`);
  for (const [id, ch] of client.channels.cache) {
    console.log(`  ${id} - type:${ch.type} ${(ch as any).name ?? "(no name)"}`);
  }
});

client.on(Events.MessageCreate, (message) => {
  console.log(`\n>>> MESSAGE: [${message.channelId}] ${message.author.username}: ${message.content}`);
});

client.on("error", (e) => console.error("Error:", e.message));

console.log("Connecting...");
client.login(token).then(() => {
  console.log("Login successful. Listening for messages... (Ctrl+C to stop)");
  setTimeout(() => {
    console.log("\n30s timeout reached. Exiting.");
    client.destroy();
    process.exit(0);
  }, 30000);
});
