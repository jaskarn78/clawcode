// Package main — Phase 110 Stage 0b Wave 0 spike entrypoint.
//
// Single-binary MCP shim with --type dispatch. Wave 0 supports search-only
// (initialize handshake + tools/list passthrough — NO daemon IPC, NO real
// translation). Purpose: measure RSS on production-shaped clawdy host before
// committing structural Wave 1+ work.
package main

import (
	"context"
	"flag"
	"log/slog"
	"os"

	"github.com/jjagpal/clawcode-shim/internal/shim/search"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Phase 108 broker exit-code semantics — match exactly so Claude Code
// SDK 0.2.97 respawn behavior is identical between Node and Go shims.
const (
	SHIM_EXIT_OK       = 0
	SHIM_EXIT_USAGE    = 64
	SHIM_EXIT_TEMPFAIL = 75
)

func main() {
	// slog ALWAYS to stderr — stdout is owned by the MCP SDK (Pitfall §6).
	logger := slog.New(slog.NewJSONHandler(os.Stderr, nil))

	serverType := flag.String("type", "", "search|image|browser (required)")
	flag.Parse()

	if *serverType == "" {
		logger.Error("missing required flag", "flag", "--type")
		os.Exit(SHIM_EXIT_USAGE)
	}

	// Wave 0 spike: only `--type search` is recognized. Wave 2-4 land
	// image and browser. Unknown types exit 64 (USAGE).
	server := mcp.NewServer(
		&mcp.Implementation{Name: *serverType, Version: "0.1.0-spike"},
		nil,
	)

	switch *serverType {
	case "search":
		search.RegisterSpike(server)
	default:
		logger.Error("unknown serverType", "serverType", *serverType)
		os.Exit(SHIM_EXIT_USAGE)
	}

	logger.Info("spike shim starting", "serverType", *serverType, "version", "0.1.0-spike")
	if err := server.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
		logger.Error("server.Run", "err", err, "serverType", *serverType)
		os.Exit(SHIM_EXIT_TEMPFAIL)
	}
	os.Exit(SHIM_EXIT_OK)
}
