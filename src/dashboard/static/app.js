/**
 * ClawCode Dashboard — Client-side application.
 * Handles SSE events, agent card rendering, panel rendering, and control actions.
 */

/** @type {EventSource | null} */
let eventSource = null;

/** @type {{ delivered: number; totalEnqueued: number } | null} */
let lastDeliveryStats = null;

/**
 * Format uptime from a startedAt timestamp.
 * @param {number | null} startedAt - Unix timestamp in ms
 * @returns {string}
 */
function formatUptime(startedAt) {
  if (startedAt === null || startedAt === undefined) return "--";

  const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const days = Math.floor(elapsed / 86400);
  const hours = Math.floor((elapsed % 86400) / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Format a timestamp as relative time (e.g. "in 3m", "2h ago").
 * @param {number | string | null} ts - Unix timestamp in ms or ISO string
 * @returns {string}
 */
function formatRelativeTime(ts) {
  if (ts === null || ts === undefined) return "--";
  const now = Date.now();
  const target = typeof ts === "string" ? new Date(ts).getTime() : ts;
  const diffMs = target - now;
  const absDiff = Math.abs(diffMs);

  const minutes = Math.floor(absDiff / 60000);
  const hours = Math.floor(absDiff / 3600000);
  const days = Math.floor(absDiff / 86400000);

  let label;
  if (days > 0) label = `${days}d`;
  else if (hours > 0) label = `${hours}h`;
  else if (minutes > 0) label = `${minutes}m`;
  else label = "<1m";

  return diffMs >= 0 ? `in ${label}` : `${label} ago`;
}

/**
 * Get the CSS color variable for a context zone.
 * @param {string | null} zone
 * @returns {string}
 */
function zoneColor(zone) {
  switch (zone) {
    case "green": return "var(--zone-green)";
    case "yellow": return "var(--zone-yellow)";
    case "orange": return "var(--zone-orange)";
    case "red": return "var(--zone-red)";
    default: return "var(--text-secondary)";
  }
}

/**
 * Get the CSS class for a status badge.
 * @param {string} status
 * @returns {string}
 */
function statusClass(status) {
  switch (status) {
    case "running": return "running";
    case "stopped": return "stopped";
    case "crashed":
    case "failed": return "crashed";
    case "starting":
    case "restarting": return "starting";
    case "stopping": return "stopping";
    default: return "stopped";
  }
}

/**
 * Create an agent card HTML string.
 * @param {object} agent
 * @param {number} index
 * @returns {string}
 */
function createAgentCard(agent, index) {
  const uptime = formatUptime(agent.startedAt);
  const fillPct = agent.fillPercentage !== null ? agent.fillPercentage : 0;
  const fillLabel = agent.fillPercentage !== null ? `${Math.round(fillPct)}%` : "--";
  const zoneClr = zoneColor(agent.zone);
  const channels = (agent.channels || [])
    .map((ch) => `<span class="channel-tag">${escapeHtml(ch)}</span>`)
    .join("");
  const errorBlock = agent.lastError
    ? `<div class="agent-error">${escapeHtml(agent.lastError)}</div>`
    : "";

  return `
    <div class="agent-card" style="animation-delay: ${index * 0.05}s">
      <div class="agent-card-header">
        <span class="agent-name">${escapeHtml(agent.name)}</span>
        <span class="status-badge ${statusClass(agent.status)}">${escapeHtml(agent.status)}</span>
      </div>
      <div class="agent-meta">
        <div class="agent-meta-row">
          <span class="meta-label">uptime</span>
          <span class="meta-value">${uptime}</span>
        </div>
        <div class="agent-meta-row">
          <span class="meta-label">restarts</span>
          <span class="meta-value">${agent.restartCount}</span>
        </div>
      </div>
      <div class="zone-bar-container">
        <div class="zone-bar-label">
          <span class="zone-bar-label-text">context</span>
          <span class="zone-bar-pct" style="color: ${zoneClr}">${fillLabel}</span>
        </div>
        <div class="zone-bar">
          <div class="zone-bar-fill" style="width: ${fillPct}%; background: ${zoneClr}"></div>
        </div>
      </div>
      ${channels ? `<div class="channel-tags">${channels}</div>` : ""}
      ${errorBlock}
      <div class="agent-actions">
        <button class="action-btn" onclick="agentAction('${escapeAttr(agent.name)}', 'start')">Start</button>
        <button class="action-btn danger" onclick="agentAction('${escapeAttr(agent.name)}', 'stop')">Stop</button>
        <button class="action-btn" onclick="agentAction('${escapeAttr(agent.name)}', 'restart')">Restart</button>
      </div>
    </div>
  `;
}

/**
 * Render all agent cards into the grid.
 * @param {Array} agents
 */
function renderAgentCards(agents) {
  const grid = document.getElementById("agent-grid");
  if (!grid) return;

  if (!agents || agents.length === 0) {
    grid.innerHTML = '<div class="panel-placeholder">No agents registered</div>';
    return;
  }

  grid.innerHTML = agents.map((agent, i) => createAgentCard(agent, i)).join("");
}

/**
 * Render the schedules panel with a task table.
 * @param {{ schedules: Array }} data
 */
function renderSchedulesPanel(data) {
  const container = document.getElementById("schedules-content");
  if (!container) return;

  const schedules = data.schedules || [];
  if (schedules.length === 0) {
    container.innerHTML = '<div class="panel-placeholder">No scheduled tasks</div>';
    return;
  }

  const rows = schedules
    .map((s) => {
      const statusDot = s.lastStatus === "success"
        ? "dot-success"
        : s.lastStatus === "error"
        ? "dot-error"
        : "dot-pending";
      const disabledClass = s.enabled ? "" : " schedule-disabled";
      const errorTooltip = s.lastError ? ` title="${escapeAttr(s.lastError)}"` : "";
      const nextRun = formatRelativeTime(s.nextRun);

      return `<tr class="schedule-row${disabledClass}">
        <td class="schedule-agent">${escapeHtml(s.agentName)}</td>
        <td class="schedule-task">${escapeHtml(s.name)}</td>
        <td class="schedule-cron"><code>${escapeHtml(s.cron)}</code></td>
        <td class="schedule-next">${nextRun}</td>
        <td class="schedule-status"><span class="status-dot ${statusDot}"${errorTooltip}></span></td>
      </tr>`;
    })
    .join("");

  container.innerHTML = `
    <table class="schedules-table">
      <thead>
        <tr>
          <th>Agent</th>
          <th>Task</th>
          <th>Cron</th>
          <th>Next Run</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

/**
 * Render the health panel with per-agent health cards.
 * @param {{ agents: Object }} data
 */
function renderHealthPanel(data) {
  const container = document.getElementById("health-content");
  if (!container) return;

  const agents = data.agents || {};
  const names = Object.keys(agents);
  if (names.length === 0) {
    container.innerHTML = '<div class="panel-placeholder">No health data</div>';
    return;
  }

  const cards = names
    .map((name) => {
      const info = agents[name];
      const overallClass = info.overall === "healthy"
        ? "dot-success"
        : info.overall === "degraded"
        ? "dot-warning"
        : "dot-error";

      const zoneFill = info.fillPercentage != null ? info.fillPercentage : 0;
      const zoneLabel = info.zone || "unknown";
      const zoneClr = zoneColor(info.zone || null);

      const checks = Object.entries(info.checks || {})
        .map(([checkName, check]) => {
          const checkDot = check.status === "pass"
            ? "dot-success"
            : check.status === "warn"
            ? "dot-warning"
            : "dot-error";
          return `<div class="health-check-row">
            <span class="status-dot ${checkDot}"></span>
            <span class="health-check-name">${escapeHtml(checkName)}</span>
            <span class="health-check-msg">${escapeHtml(check.message)}</span>
          </div>`;
        })
        .join("");

      return `<div class="health-card">
        <div class="health-card-header">
          <span class="health-agent-name">${escapeHtml(name)}</span>
          <span class="status-dot ${overallClass}"></span>
        </div>
        <div class="zone-bar-container">
          <div class="zone-bar-label">
            <span class="zone-bar-label-text">${escapeHtml(zoneLabel)}</span>
            <span class="zone-bar-pct" style="color: ${zoneClr}">${Math.round(zoneFill)}%</span>
          </div>
          <div class="zone-bar zone-bar-lg">
            <div class="zone-bar-fill" style="width: ${zoneFill}%; background: ${zoneClr}"></div>
          </div>
        </div>
        <div class="health-checks">${checks}</div>
      </div>`;
    })
    .join("");

  container.innerHTML = cards;
}

/**
 * Render the delivery queue panel with stats and failed entries.
 * @param {{ stats: Object, failed: Array }} data
 */
function renderDeliveryPanel(data) {
  const container = document.getElementById("delivery-content");
  if (!container) return;

  const stats = data.stats || { pending: 0, inFlight: 0, failed: 0, delivered: 0, totalEnqueued: 0 };

  // Cache stats for messages panel
  lastDeliveryStats = { delivered: stats.delivered, totalEnqueued: stats.totalEnqueued };
  renderMessagesPanel();

  const failed = data.failed || [];

  const statsHtml = `
    <div class="delivery-stats">
      <div class="stat-card">
        <span class="stat-number">${stats.pending}</span>
        <span class="stat-label">Pending</span>
      </div>
      <div class="stat-card">
        <span class="stat-number">${stats.inFlight}</span>
        <span class="stat-label">In Flight</span>
      </div>
      <div class="stat-card">
        <span class="stat-number stat-failed">${stats.failed}</span>
        <span class="stat-label">Failed</span>
      </div>
      <div class="stat-card">
        <span class="stat-number stat-delivered">${stats.delivered}</span>
        <span class="stat-label">Delivered</span>
      </div>
    </div>
  `;

  let failedHtml = "";
  if (failed.length > 0) {
    const rows = failed
      .map((f) => {
        const truncId = (f.id || "").substring(0, 8);
        const truncContent = (f.content || "").substring(0, 40);
        return `<tr class="failed-row">
          <td class="failed-id"><code>${escapeHtml(truncId)}</code></td>
          <td class="failed-agent">${escapeHtml(f.agentName)}</td>
          <td class="failed-error">${escapeHtml(f.lastError || "--")}</td>
          <td class="failed-time">${formatRelativeTime(f.createdAt)}</td>
          <td class="failed-attempts">${f.attempts}</td>
        </tr>`;
      })
      .join("");

    failedHtml = `
      <table class="failed-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Agent</th>
            <th>Error</th>
            <th>Created</th>
            <th>Tries</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  } else {
    failedHtml = '<div class="panel-placeholder">No failed deliveries</div>';
  }

  container.innerHTML = statsHtml + failedHtml;
}

/**
 * Render the memory panel with per-agent memory cards.
 * @param {{ agents: Object }} data
 */
function renderMemoryPanel(data) {
  const container = document.getElementById("memory-content");
  if (!container) return;

  const agents = data.agents || {};
  const names = Object.keys(agents);
  if (names.length === 0) {
    container.innerHTML = '<div class="panel-placeholder">No memory data</div>';
    return;
  }

  const cards = names
    .map((name) => {
      const info = agents[name];
      const tiers = info.tierDistribution || {};
      const total = Object.values(tiers).reduce((sum, v) => sum + v, 0) || info.entryCount || 0;

      // Build tier bar segments
      const hotPct = total > 0 ? ((tiers.hot || 0) / total) * 100 : 0;
      const warmPct = total > 0 ? ((tiers.warm || 0) / total) * 100 : 0;
      const coldPct = total > 0 ? ((tiers.cold || 0) / total) * 100 : 0;

      return `<div class="memory-card">
        <span class="memory-agent-name">${escapeHtml(name)}</span>
        <div class="memory-stats-row">
          <span class="memory-entry-count">${info.entryCount}</span>
          <span class="memory-stat-label">entries</span>
          <span class="memory-episode-count">${info.episodeCount}</span>
          <span class="memory-stat-label">episodes</span>
        </div>
        <div class="tier-bar">
          <div class="tier-segment tier-hot" style="width: ${hotPct}%" title="Hot: ${tiers.hot || 0}"></div>
          <div class="tier-segment tier-warm" style="width: ${warmPct}%" title="Warm: ${tiers.warm || 0}"></div>
          <div class="tier-segment tier-cold" style="width: ${coldPct}%" title="Cold: ${tiers.cold || 0}"></div>
        </div>
      </div>`;
    })
    .join("");

  container.innerHTML = cards;
}

/**
 * Render the messages panel using delivery queue stats.
 */
function renderMessagesPanel() {
  const container = document.getElementById("messages-content");
  if (!container) return;

  if (!lastDeliveryStats) {
    container.innerHTML = '<div class="panel-placeholder">Waiting for data...</div>';
    return;
  }

  container.innerHTML = `
    <div class="messages-stats">
      <div class="stat-card">
        <span class="stat-number stat-delivered">${lastDeliveryStats.delivered}</span>
        <span class="stat-label">Messages Sent</span>
      </div>
      <div class="stat-card">
        <span class="stat-number">${lastDeliveryStats.totalEnqueued}</span>
        <span class="stat-label">Total Queued</span>
      </div>
    </div>
  `;
}

/**
 * Escape HTML entities for safe rendering.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Escape a string for use in HTML attributes.
 * @param {string} str
 * @returns {string}
 */
function escapeAttr(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, "&quot;");
}

/**
 * Send an agent control action (start/stop/restart).
 * @param {string} name
 * @param {string} action
 */
async function agentAction(name, action) {
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(name)}/${action}`, {
      method: "POST",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.error(`Action ${action} failed:`, data);
    }
  } catch (err) {
    console.error(`Action ${action} error:`, err);
  }
}

/**
 * Set the connection status indicator.
 * @param {boolean} connected
 */
function setConnectionStatus(connected) {
  const dot = document.getElementById("connection-dot");
  if (!dot) return;

  if (connected) {
    dot.classList.remove("disconnected");
    dot.classList.add("connected");
  } else {
    dot.classList.remove("connected");
    dot.classList.add("disconnected");
  }
}

/**
 * Connect to the SSE endpoint.
 */
function connectSSE() {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource("/api/events");

  eventSource.addEventListener("agent-status", (event) => {
    try {
      const state = JSON.parse(event.data);
      renderAgentCards(state.agents);
    } catch (err) {
      console.error("Failed to parse agent-status event:", err);
    }
  });

  eventSource.addEventListener("schedules", (event) => {
    try {
      renderSchedulesPanel(JSON.parse(event.data));
    } catch (err) {
      console.error("Failed to parse schedules event:", err);
    }
  });

  eventSource.addEventListener("health", (event) => {
    try {
      renderHealthPanel(JSON.parse(event.data));
    } catch (err) {
      console.error("Failed to parse health event:", err);
    }
  });

  eventSource.addEventListener("delivery-queue", (event) => {
    try {
      renderDeliveryPanel(JSON.parse(event.data));
    } catch (err) {
      console.error("Failed to parse delivery-queue event:", err);
    }
  });

  eventSource.addEventListener("memory-stats", (event) => {
    try {
      renderMemoryPanel(JSON.parse(event.data));
    } catch (err) {
      console.error("Failed to parse memory-stats event:", err);
    }
  });

  eventSource.addEventListener("error", (event) => {
    if (event.data) {
      try {
        const data = JSON.parse(event.data);
        console.warn("SSE error event:", data.message);
      } catch {
        // Not a JSON error event, just a connection error
      }
    }
    setConnectionStatus(false);
  });

  eventSource.addEventListener("open", () => {
    setConnectionStatus(true);
  });

  eventSource.onerror = () => {
    setConnectionStatus(false);
  };
}

/**
 * Initial load: fetch status and start SSE.
 */
async function init() {
  // Fetch initial status
  try {
    const res = await fetch("/api/status");
    if (res.ok) {
      const state = await res.json();
      renderAgentCards(state.agents);
      setConnectionStatus(true);
    }
  } catch {
    setConnectionStatus(false);
  }

  // Start SSE
  connectSSE();
}

document.addEventListener("DOMContentLoaded", init);
