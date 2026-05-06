// Package search — Wave 0 spike. NO daemon IPC, NO real tool calls.
// Just enough surface to complete MCP initialize handshake and answer
// tools/list with one stub tool. The point is to measure RSS, NOT to
// serve traffic.
package search

import (
	"context"
	"encoding/json"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// SpikeArgs is the typed argument for the Wave 0 stub tool.
//
// The MCP Go SDK's typed AddTool generic uses this struct for input
// validation against the JSON schema we declare on the Tool. The shape
// MUST match the JSON schema's required fields.
type SpikeArgs struct {
	Query string `json:"query"`
}

// RegisterSpike registers the Wave 0 stub `web_search` tool on the given
// server. The tool returns a fixed string ("spike-ok") on every call —
// it is NOT a translator. The point of the spike is to measure RSS of a
// fully-initialized MCP server with one registered tool, NOT to serve
// real traffic.
//
// Returns nil. The mcp.AddTool generic panics on invalid schema; that
// panic surfaces as an SDK-level startup failure, which the caller's
// server.Run() will report on stderr — matching the Pitfall §6 stdout
// hygiene contract.
func RegisterSpike(server *mcp.Server) error {
	schema := json.RawMessage(`{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}`)
	mcp.AddTool(
		server,
		&mcp.Tool{
			Name:        "web_search",
			Description: "Wave 0 spike stub — returns a fixed string. NOT for production use.",
			InputSchema: schema,
		},
		func(ctx context.Context, req *mcp.CallToolRequest, args SpikeArgs) (*mcp.CallToolResult, any, error) {
			return &mcp.CallToolResult{
				Content: []mcp.Content{
					&mcp.TextContent{Text: "spike-ok"},
				},
			}, nil, nil
		},
	)
	return nil
}
