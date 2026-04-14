import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    // Exclude stale copies of the project under .claude/worktrees that contain
    // outdated test files (e.g. src/mcp/server.test.ts with old tool counts).
    // These are scratch copies from prior agent runs — not part of the main tree.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*",
      ".claude/worktrees/**",
    ],
  },
});
