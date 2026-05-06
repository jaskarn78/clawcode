// Package main — Phase 110 Stage 0b production MCP shim entrypoint.
//
// Single-binary MCP shim with --type dispatch. Wave 2 (this build)
// supports search end-to-end via the daemon's `list-mcp-tools` +
// `search-tool-call` IPC methods. Image and browser dispatch to stubs
// that exit SHIM_EXIT_USAGE (64) until plans 110-06 (image) and 110-07
// (browser) extend Register for those types.
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
//
// Pitfall §5: SDK respawns on exit-75 (TEMPFAIL); other non-zero exit
// codes are interpreted as permanent failures and disable the tool for
// the session. Daemon-side failures and unexpected panics MUST exit 75.
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

	// Panic recovery: any unexpected runtime panic in our code (or in
	// the Go SDK's request dispatch) exits 75 so the SDK respawns the
	// shim on next tool need (Pitfall §5). Without this, Go's default
	// behavior would be exit 2, which the SDK interprets as a permanent
	// failure and would disable the tool for the entire claude session.
	defer func() {
		if r := recover(); r != nil {
			logger.Error("panic in shim", "panic", r, "serverType", *serverType)
			os.Exit(SHIM_EXIT_TEMPFAIL)
		}
	}()

	if *serverType == "" {
		logger.Error("missing required flag", "flag", "--type")
		os.Exit(SHIM_EXIT_USAGE)
	}

	server := mcp.NewServer(
		&mcp.Implementation{Name: *serverType, Version: "0.1.0"},
		nil,
	)

	switch *serverType {
	case "search":
		if err := search.Register(server); err != nil {
			// Boot-time IPC failure (daemon unreachable, list-mcp-tools
			// failed, or CLAWCODE_AGENT unset). Exit 75 so SDK respawns
			// once the daemon is back up.
			logger.Error("search.Register failed", "err", err)
			os.Exit(SHIM_EXIT_TEMPFAIL)
		}
	case "image":
		// Stub — Wave 3 (plan 110-06) extends this case with the real
		// image Register call. Until then, exit USAGE so operators see
		// a clear "not implemented" signal.
		logger.Error("image shim not yet implemented in Stage 0b Wave 2 — see plan 110-06 (image)",
			"serverType", *serverType)
		os.Exit(SHIM_EXIT_USAGE)
	case "browser":
		// Stub — Wave 4 (plan 110-07) extends this case with the real
		// browser Register call. Until then, exit USAGE.
		logger.Error("browser shim not yet implemented in Stage 0b Wave 2 — see plan 110-07 (browser)",
			"serverType", *serverType)
		os.Exit(SHIM_EXIT_USAGE)
	default:
		logger.Error("unknown serverType", "serverType", *serverType)
		os.Exit(SHIM_EXIT_USAGE)
	}

	logger.Info("shim starting", "serverType", *serverType, "version", "0.1.0")
	if err := server.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
		// Pitfall §5 — exit 75 (SHIM_EXIT_TEMPFAIL) signals "transient
		// failure, please retry" to Claude Code SDK 0.2.97. SDK respawns
		// on next tool need. Phase 108 broker uses identical semantics.
		logger.Error("server.Run failed", "err", err, "serverType", *serverType)
		os.Exit(SHIM_EXIT_TEMPFAIL)
	}
	os.Exit(SHIM_EXIT_OK)
}
