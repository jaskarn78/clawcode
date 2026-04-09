import type { Command } from "commander";
import { createInterface } from "node:readline";
import { readFile, writeFile } from "node:fs/promises";
import { parse, stringify } from "yaml";
import { cliLog, cliError } from "../output.js";

const VALID_MODELS = ["sonnet", "opus", "haiku"] as const;
type ValidModel = (typeof VALID_MODELS)[number];

/**
 * Prompt the user with a question and return their answer.
 */
function ask(
  rl: ReturnType<typeof createInterface>,
  question: string,
): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

/**
 * Register the `clawcode agent-create` command.
 * Interactive wizard that prompts for agent details and appends to config YAML.
 */
export function registerAgentCreateCommand(program: Command): void {
  program
    .command("agent-create")
    .description("Create a new agent interactively")
    .option("-c, --config <path>", "Path to config file", "clawcode.yaml")
    .action(async (opts: { config: string }) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      try {
        // Prompt for name (required)
        let name = "";
        while (name === "") {
          name = await ask(rl, "Agent name: ");
          if (name === "") {
            cliLog("Name is required.");
          }
        }

        // Prompt for channel ID (required)
        let channelId = "";
        while (channelId === "") {
          channelId = await ask(rl, "Discord channel ID: ");
          if (channelId === "") {
            cliLog("Channel ID is required.");
          }
        }

        // Prompt for soul/personality (required)
        let soulText = "";
        while (soulText === "") {
          soulText = await ask(rl, "Soul/personality description: ");
          if (soulText === "") {
            cliLog("Soul description is required.");
          }
        }

        // Prompt for model (default: sonnet)
        let model: ValidModel = "sonnet";
        const modelInput = await ask(
          rl,
          "Model (sonnet/opus/haiku) [sonnet]: ",
        );
        if (modelInput !== "") {
          if (!VALID_MODELS.includes(modelInput as ValidModel)) {
            cliError(
              `Error: Invalid model '${modelInput}'. Must be one of: ${VALID_MODELS.join(", ")}`,
            );
            rl.close();
            process.exit(1);
            return;
          }
          model = modelInput as ValidModel;
        }

        rl.close();

        // Read and parse existing config
        const content = await readFile(opts.config, "utf-8");
        const parsed = parse(content) as { agents: Array<Record<string, unknown>> };

        // Build new agent object
        const newAgent: Record<string, unknown> = {
          name,
          channels: [channelId],
          soul: soulText,
        };

        // Only include model if not the default
        if (model !== "sonnet") {
          newAgent.model = model;
        }

        parsed.agents.push(newAgent);

        await writeFile(opts.config, stringify(parsed, { lineWidth: 120 }));
        cliLog(`Agent '${name}' added to ${opts.config}`);
      } catch (error) {
        rl.close();
        const message =
          error instanceof Error ? error.message : String(error);
        cliError(`Error: ${message}`);
        process.exit(1);
      }
    });
}
