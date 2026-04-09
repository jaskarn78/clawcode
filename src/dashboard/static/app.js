/**
 * ClawCode Dashboard — Client-side application.
 * Handles SSE events, agent card rendering, and control actions.
 */

/** @type {EventSource | null} */
let eventSource = null;

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
  const buttons = document.querySelectorAll(".action-btn");
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
