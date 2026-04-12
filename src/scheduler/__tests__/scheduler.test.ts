import { describe, it, expect, vi, beforeEach } from "vitest";
import { TaskScheduler } from "../scheduler.js";
import type { ScheduleEntry } from "../types.js";

function createMockSessionManager() {
  return {
    sendToAgent: vi.fn().mockResolvedValue("Task completed"),
  } as any;
}

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as any;
}

describe("TaskScheduler", () => {
  let sessionManager: ReturnType<typeof createMockSessionManager>;
  let log: ReturnType<typeof createMockLogger>;
  let scheduler: TaskScheduler;

  beforeEach(() => {
    sessionManager = createMockSessionManager();
    log = createMockLogger();
    scheduler = new TaskScheduler({ sessionManager, log });
  });

  it("addAgent creates cron jobs for enabled schedules only", () => {
    const schedules: readonly ScheduleEntry[] = [
      { name: "report", cron: "0 9 * * *", prompt: "Generate report", enabled: true },
      { name: "cleanup", cron: "0 0 * * 0", prompt: "Clean up", enabled: false },
      { name: "check", cron: "*/30 * * * *", prompt: "Status check", enabled: true },
    ];

    scheduler.addAgent("alice", schedules);

    const statuses = scheduler.getAgentStatuses("alice");
    // Only enabled schedules should create jobs and statuses
    expect(statuses).toHaveLength(2);
    expect(statuses.map((s) => s.name)).toEqual(["report", "check"]);
  });

  it("addAgent skips disabled schedules", () => {
    const schedules: readonly ScheduleEntry[] = [
      { name: "disabled-task", cron: "0 9 * * *", prompt: "Should not run", enabled: false },
    ];

    scheduler.addAgent("bob", schedules);

    const statuses = scheduler.getAgentStatuses("bob");
    expect(statuses).toHaveLength(0);
  });

  it("cron trigger calls sendToAgent with the schedule prompt", async () => {
    const schedules: readonly ScheduleEntry[] = [
      { name: "daily", cron: "0 9 * * *", prompt: "Generate daily report", enabled: true },
    ];

    scheduler.addAgent("alice", schedules);

    // Manually trigger the cron callback
    await scheduler._triggerForTest("alice", "daily");

    expect(sessionManager.sendToAgent).toHaveBeenCalledWith("alice", "Generate daily report");
  });

  it("failed sendToAgent records error status but scheduler continues", async () => {
    sessionManager.sendToAgent.mockRejectedValueOnce(new Error("Agent unreachable"));

    const schedules: readonly ScheduleEntry[] = [
      { name: "failing-task", cron: "0 9 * * *", prompt: "Will fail", enabled: true },
    ];

    scheduler.addAgent("alice", schedules);
    await scheduler._triggerForTest("alice", "failing-task");

    const statuses = scheduler.getAgentStatuses("alice");
    const failedStatus = statuses.find((s) => s.name === "failing-task");
    expect(failedStatus).toBeDefined();
    expect(failedStatus!.lastStatus).toBe("error");
    expect(failedStatus!.lastError).toBe("Agent unreachable");
    expect(failedStatus!.lastRun).toBeTypeOf("number");
  });

  it("removeAgent stops all cron jobs for that agent", () => {
    const schedules: readonly ScheduleEntry[] = [
      { name: "task-1", cron: "0 9 * * *", prompt: "Task 1", enabled: true },
      { name: "task-2", cron: "0 18 * * *", prompt: "Task 2", enabled: true },
    ];

    scheduler.addAgent("alice", schedules);
    expect(scheduler.getAgentStatuses("alice")).toHaveLength(2);

    scheduler.removeAgent("alice");
    expect(scheduler.getAgentStatuses("alice")).toHaveLength(0);
  });

  it("getStatuses returns all schedule statuses across agents", () => {
    scheduler.addAgent("alice", [
      { name: "task-a", cron: "0 9 * * *", prompt: "A", enabled: true },
    ]);
    scheduler.addAgent("bob", [
      { name: "task-b", cron: "0 18 * * *", prompt: "B", enabled: true },
      { name: "task-c", cron: "*/5 * * * *", prompt: "C", enabled: true },
    ]);

    const allStatuses = scheduler.getStatuses();
    expect(allStatuses).toHaveLength(3);
    expect(allStatuses.map((s) => s.name).sort()).toEqual(["task-a", "task-b", "task-c"]);
  });

  it("stop cancels all cron jobs for all agents", () => {
    scheduler.addAgent("alice", [
      { name: "task-1", cron: "0 9 * * *", prompt: "Task 1", enabled: true },
    ]);
    scheduler.addAgent("bob", [
      { name: "task-2", cron: "0 18 * * *", prompt: "Task 2", enabled: true },
    ]);

    scheduler.stop();

    // After stop, getStatuses returns empty (jobs removed)
    expect(scheduler.getStatuses()).toHaveLength(0);
  });

  it("tasks run one at a time per agent (sequential, not parallel)", async () => {
    let concurrentCount = 0;
    let maxConcurrent = 0;

    sessionManager.sendToAgent.mockImplementation(async () => {
      concurrentCount++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      // Simulate work
      await new Promise((resolve) => setTimeout(resolve, 10));
      concurrentCount--;
      return "done";
    });

    const schedules: readonly ScheduleEntry[] = [
      { name: "task-1", cron: "* * * * *", prompt: "Task 1", enabled: true },
      { name: "task-2", cron: "* * * * *", prompt: "Task 2", enabled: true },
    ];

    scheduler.addAgent("alice", schedules);

    // Trigger both tasks concurrently
    const trigger1 = scheduler._triggerForTest("alice", "task-1");
    const trigger2 = scheduler._triggerForTest("alice", "task-2");

    await Promise.all([trigger1, trigger2]);

    // The second task should have been skipped (lock held)
    // So sendToAgent should have been called only once
    expect(sessionManager.sendToAgent).toHaveBeenCalledTimes(1);
  });

  it("handler-based schedule calls handler instead of sendToAgent", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const schedules: readonly ScheduleEntry[] = [
      { name: "consolidation", cron: "0 3 * * *", handler, enabled: true },
    ];

    scheduler.addAgent("alice", schedules);
    await scheduler._triggerForTest("alice", "consolidation");

    expect(handler).toHaveBeenCalledOnce();
    expect(sessionManager.sendToAgent).not.toHaveBeenCalled();
  });

  it("handler error records error status", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("Consolidation failed"));
    const schedules: readonly ScheduleEntry[] = [
      { name: "failing-handler", cron: "0 3 * * *", handler, enabled: true },
    ];

    scheduler.addAgent("alice", schedules);
    await scheduler._triggerForTest("alice", "failing-handler");

    const statuses = scheduler.getAgentStatuses("alice");
    const failedStatus = statuses.find((s) => s.name === "failing-handler");
    expect(failedStatus).toBeDefined();
    expect(failedStatus!.lastStatus).toBe("error");
    expect(failedStatus!.lastError).toBe("Consolidation failed");
    expect(failedStatus!.lastRun).toBeTypeOf("number");
  });

  it("successful task updates status to success with lastRun", async () => {
    const schedules: readonly ScheduleEntry[] = [
      { name: "good-task", cron: "0 9 * * *", prompt: "Do something", enabled: true },
    ];

    scheduler.addAgent("alice", schedules);

    const beforeStatuses = scheduler.getAgentStatuses("alice");
    expect(beforeStatuses[0].lastStatus).toBe("pending");
    expect(beforeStatuses[0].lastRun).toBeNull();

    await scheduler._triggerForTest("alice", "good-task");

    const afterStatuses = scheduler.getAgentStatuses("alice");
    expect(afterStatuses[0].lastStatus).toBe("success");
    expect(afterStatuses[0].lastRun).toBeTypeOf("number");
  });
});
