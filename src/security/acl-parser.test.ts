import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseSecurityMd, checkChannelAccess } from "./acl-parser.js";
import type { ChannelAcl } from "./types.js";

describe("parseSecurityMd", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `acl-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("parses channel with users", async () => {
    const content = `## Channel ACLs
- channel: 123
  users: [alice, bob]`;
    const filePath = join(tmpDir, "SECURITY.md");
    await writeFile(filePath, content, "utf-8");

    const result = await parseSecurityMd(filePath);
    expect(result).toEqual([
      { channelId: "123", allowedUserIds: ["alice", "bob"], allowedRoles: [] },
    ]);
  });

  it("parses channel with roles", async () => {
    const content = `## Channel ACLs
- channel: 456
  roles: [admin, mod]`;
    const filePath = join(tmpDir, "SECURITY.md");
    await writeFile(filePath, content, "utf-8");

    const result = await parseSecurityMd(filePath);
    expect(result).toEqual([
      { channelId: "456", allowedUserIds: [], allowedRoles: ["admin", "mod"] },
    ]);
  });

  it("parses channel with both users and roles", async () => {
    const content = `## Channel ACLs
- channel: 789
  users: [alice]
  roles: [admin]`;
    const filePath = join(tmpDir, "SECURITY.md");
    await writeFile(filePath, content, "utf-8");

    const result = await parseSecurityMd(filePath);
    expect(result).toEqual([
      { channelId: "789", allowedUserIds: ["alice"], allowedRoles: ["admin"] },
    ]);
  });

  it("returns empty array for missing file", async () => {
    const result = await parseSecurityMd(join(tmpDir, "nonexistent.md"));
    expect(result).toEqual([]);
  });

  it("returns empty array when no ACL section exists", async () => {
    const content = `# Security Policy\n\nSome other content.`;
    const filePath = join(tmpDir, "SECURITY.md");
    await writeFile(filePath, content, "utf-8");

    const result = await parseSecurityMd(filePath);
    expect(result).toEqual([]);
  });

  it("parses multiple channel entries", async () => {
    const content = `## Channel ACLs
- channel: 100
  users: [alice]
- channel: 200
  roles: [mod]`;
    const filePath = join(tmpDir, "SECURITY.md");
    await writeFile(filePath, content, "utf-8");

    const result = await parseSecurityMd(filePath);
    expect(result).toHaveLength(2);
    expect(result[0].channelId).toBe("100");
    expect(result[1].channelId).toBe("200");
  });
});

describe("checkChannelAccess", () => {
  const acls: readonly ChannelAcl[] = [
    { channelId: "123", allowedUserIds: ["alice", "bob"], allowedRoles: ["admin"] },
    { channelId: "456", allowedUserIds: [], allowedRoles: ["mod"] },
  ];

  it("allows user in allowedUserIds", () => {
    expect(checkChannelAccess("123", "alice", [], acls)).toBe(true);
  });

  it("denies user not in allowedUserIds or roles", () => {
    expect(checkChannelAccess("123", "eve", [], acls)).toBe(false);
  });

  it("allows user with matching role", () => {
    expect(checkChannelAccess("123", "eve", ["admin"], acls)).toBe(true);
  });

  it("returns true for channel not in ACLs (open by default)", () => {
    expect(checkChannelAccess("999", "anyone", [], acls)).toBe(true);
  });

  it("denies user with non-matching role", () => {
    expect(checkChannelAccess("456", "eve", ["viewer"], acls)).toBe(false);
  });

  it("allows user with one of multiple matching roles", () => {
    expect(checkChannelAccess("456", "eve", ["viewer", "mod"], acls)).toBe(true);
  });
});
