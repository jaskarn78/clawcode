import { mkdir, writeFile, readdir, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { nanoid } from "nanoid";
import type { InboxMessage, MessagePriority } from "./types.js";

/**
 * Create a new InboxMessage with a generated id and current timestamp.
 *
 * @param from - Sender agent name
 * @param to - Recipient agent name
 * @param content - Message content
 * @param priority - Message priority (defaults to "normal")
 * @returns A fully populated InboxMessage
 */
export function createMessage(
  from: string,
  to: string,
  content: string,
  priority: MessagePriority = "normal",
): InboxMessage {
  return {
    id: nanoid(),
    from,
    to,
    content,
    timestamp: Date.now(),
    priority,
  };
}

/**
 * Write a message to an agent's inbox directory as a JSON file.
 * Uses atomic write pattern: write to .tmp then rename.
 * Creates the inbox directory if it doesn't exist.
 *
 * @param inboxDir - Path to the agent's inbox directory
 * @param message - The message to write
 */
export async function writeMessage(
  inboxDir: string,
  message: InboxMessage,
): Promise<void> {
  await mkdir(inboxDir, { recursive: true });

  const filename = `${message.timestamp}-${message.from}-${nanoid(6)}.json`;
  const filePath = join(inboxDir, filename);
  const tmpPath = `${filePath}.tmp`;

  const data = JSON.stringify(message, null, 2);
  await writeFile(tmpPath, data, "utf-8");
  await rename(tmpPath, filePath);
}

/**
 * Read all messages from an agent's inbox directory.
 * Returns messages sorted by timestamp ascending.
 * Skips malformed files with a warning log.
 * Returns empty array if the directory doesn't exist.
 *
 * @param inboxDir - Path to the agent's inbox directory
 * @returns Array of parsed InboxMessages sorted by timestamp
 */
export async function readMessages(
  inboxDir: string,
): Promise<readonly InboxMessage[]> {
  let entries: string[];
  try {
    entries = await readdir(inboxDir);
  } catch {
    return [];
  }

  const jsonFiles = entries.filter((f) => f.endsWith(".json"));
  const messages: InboxMessage[] = [];

  for (const file of jsonFiles) {
    try {
      const raw = await readFile(join(inboxDir, file), "utf-8");
      const parsed = JSON.parse(raw) as InboxMessage;

      if (!parsed.id || !parsed.from || !parsed.to || !parsed.content || !parsed.timestamp) {
        console.warn(`[inbox] Skipping malformed message file: ${file}`);
        continue;
      }

      messages.push(parsed);
    } catch {
      console.warn(`[inbox] Failed to parse message file: ${file}`);
    }
  }

  return messages.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Mark a message as processed by moving it to the processed subdirectory.
 * Matches by scanning file contents for the given message id.
 * No-op if the message file is not found (idempotent).
 *
 * @param inboxDir - Path to the agent's inbox directory
 * @param messageId - The id of the message to mark as processed
 */
export async function markProcessed(
  inboxDir: string,
  messageId: string,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(inboxDir);
  } catch {
    return;
  }

  const jsonFiles = entries.filter((f) => f.endsWith(".json"));

  for (const file of jsonFiles) {
    try {
      const raw = await readFile(join(inboxDir, file), "utf-8");
      const parsed = JSON.parse(raw) as InboxMessage;

      if (parsed.id === messageId) {
        const processedDir = join(inboxDir, "processed");
        await mkdir(processedDir, { recursive: true });
        await rename(join(inboxDir, file), join(processedDir, file));
        return;
      }
    } catch {
      // Skip unreadable files
    }
  }
}
