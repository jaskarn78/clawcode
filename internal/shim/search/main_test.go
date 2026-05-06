// Package search — tests for the Wave 0 spike binary.
//
// These tests spawn the COMPILED binary via os/exec, send raw JSON-RPC
// frames over stdin, and assert envelope shapes on stdout. They are NOT
// unit tests of the search package alone — they are integration tests
// of the cmd/clawcode-mcp-shim entrypoint with the search RegisterSpike
// branch wired in.
//
// TestMain compiles the binary once into a tempdir and shares it across
// the four test cases. RED-phase TDD note: when this file is committed
// before the binary compiles, `go test` fails at TestMain with build
// errors — that is the RED signal.
package search_test

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// shimBinaryPath holds the path to the compiled spike binary, populated
// by TestMain. Each test exec's this path with different --type flags
// and stdin payloads.
var shimBinaryPath string

func TestMain(m *testing.M) {
	tmpDir, err := os.MkdirTemp("", "clawcode-mcp-shim-test-*")
	if err != nil {
		panic("TestMain: mkdir temp: " + err.Error())
	}
	defer os.RemoveAll(tmpDir)

	shimBinaryPath = filepath.Join(tmpDir, "clawcode-mcp-shim")

	// Walk up to repo root from internal/shim/search/.
	repoRoot, err := filepath.Abs(filepath.Join("..", "..", ".."))
	if err != nil {
		panic("TestMain: abs repo root: " + err.Error())
	}

	cmd := exec.Command("go", "build", "-o", shimBinaryPath, "./cmd/clawcode-mcp-shim")
	cmd.Dir = repoRoot
	cmd.Env = append(os.Environ(), "CGO_ENABLED=0")
	if out, err := cmd.CombinedOutput(); err != nil {
		panic("TestMain: build failed: " + err.Error() + "\n" + string(out))
	}

	os.Exit(m.Run())
}

// TestSpikeBinaryDispatchesSearchType spawns the binary with --type
// search, closes stdin immediately (EOF), and asserts that:
//   - Process exits cleanly (code 0).
//   - Stdout is empty (no spurious framing-corrupting writes).
//
// The SDK owns stdout for the JSON-RPC transport; our code MUST NOT
// write to it. With no input, the SDK's stdio reader hits EOF and the
// server exits cleanly via the shutdown path.
func TestSpikeBinaryDispatchesSearchType(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, shimBinaryPath, "--type", "search")
	cmd.Stdin = strings.NewReader("")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		t.Fatalf("spike binary failed: %v\nstderr: %s", err, stderr.String())
	}

	if stdout.Len() != 0 {
		t.Fatalf("spike binary wrote to stdout (SDK owns stdout!): %q", stdout.String())
	}
}

// TestSpikeRejectsUnknownType spawns the binary with --type unknown and
// asserts SHIM_EXIT_USAGE (64) per Phase 108 broker exit-code semantics.
// The SDK must NOT have started, so stdout must be empty; the error
// must surface via stderr (slog JSON line).
func TestSpikeRejectsUnknownType(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, shimBinaryPath, "--type", "unknown")
	cmd.Stdin = strings.NewReader("")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err == nil {
		t.Fatalf("expected non-zero exit for unknown type")
	}

	exitErr, ok := err.(*exec.ExitError)
	if !ok {
		t.Fatalf("expected *exec.ExitError, got %T: %v", err, err)
	}
	if exitErr.ExitCode() != 64 {
		t.Fatalf("expected exit code 64 (SHIM_EXIT_USAGE), got %d", exitErr.ExitCode())
	}

	if stdout.Len() != 0 {
		t.Fatalf("spike binary wrote to stdout (SDK owns stdout!): %q", stdout.String())
	}

	// The error MUST be logged on stderr. Any non-empty stderr satisfies this.
	if stderr.Len() == 0 {
		t.Fatalf("expected slog error on stderr; got empty stderr")
	}
}

// TestProtocolVersionPin sends the canonical Claude Code SDK 0.2.97
// `initialize` request with protocolVersion "2025-11-25" and asserts
// the server's response echoes the same protocol version. This is the
// regression pin against Pitfall §1 (protocol version drift). If a
// future Go SDK upgrade silently negotiates down to 2024-11-05 against
// our spike, this test catches it.
func TestProtocolVersionPin(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, shimBinaryPath, "--type", "search")

	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatalf("StdinPipe: %v", err)
	}
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatalf("StdoutPipe: %v", err)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}

	// Canonical Claude Code SDK 0.2.97 initialize request.
	initReq := `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}` + "\n"
	if _, err := stdin.Write([]byte(initReq)); err != nil {
		t.Fatalf("write initialize: %v", err)
	}

	// Read first newline-delimited frame from stdout.
	buf := make([]byte, 65536)
	n, err := stdoutPipe.Read(buf)
	if err != nil {
		_ = stdin.Close()
		_ = cmd.Process.Kill()
		t.Fatalf("read response: %v\nstderr: %s", err, stderr.String())
	}

	// Close stdin so the server can shut down cleanly.
	_ = stdin.Close()
	// Wait briefly; if it hangs, kill.
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		_ = cmd.Process.Kill()
		<-done
	}

	// Find the first newline-terminated frame.
	frame := buf[:n]
	if i := bytes.IndexByte(frame, '\n'); i >= 0 {
		frame = frame[:i]
	}

	var resp struct {
		JSONRPC string `json:"jsonrpc"`
		ID      int    `json:"id"`
		Result  struct {
			ProtocolVersion string `json:"protocolVersion"`
		} `json:"result"`
		Error *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(frame, &resp); err != nil {
		t.Fatalf("unmarshal response: %v\nframe: %q", err, string(frame))
	}
	if resp.Error != nil {
		t.Fatalf("initialize returned error: code=%d message=%q", resp.Error.Code, resp.Error.Message)
	}
	if resp.Result.ProtocolVersion != "2025-11-25" {
		t.Fatalf("protocolVersion mismatch: got %q, want %q", resp.Result.ProtocolVersion, "2025-11-25")
	}
}

// TestNoStdoutWritesOutsideSDK is a source-code grep that verifies our
// shim source contains zero `fmt.Println` and zero `os.Stdout.Write`
// call sites. The SDK owns stdout (Pitfall §6); any direct stdout write
// in our code corrupts the JSON-RPC framing on the next response.
//
// This test runs grep externally so the assertion checks the source as
// it lives on disk, not as compiled-in symbol references that would
// miss the case where someone added a new offending call.
func TestNoStdoutWritesOutsideSDK(t *testing.T) {
	repoRoot, err := filepath.Abs(filepath.Join("..", "..", ".."))
	if err != nil {
		t.Fatalf("abs repo root: %v", err)
	}

	cmd := exec.Command("grep", "-rE",
		`fmt\.Println|os\.Stdout\.Write`,
		filepath.Join(repoRoot, "cmd", "clawcode-mcp-shim"),
		filepath.Join(repoRoot, "internal", "shim", "search"),
	)
	out, err := cmd.CombinedOutput()
	// grep exits 1 when no matches found — that is our success case.
	// grep exits 0 when matches are found — that is our failure case.
	if err == nil {
		// Filter: ignore any matches inside the test file itself (this file
		// must contain the literal pattern strings to perform the check).
		lines := strings.Split(strings.TrimSpace(string(out)), "\n")
		var bad []string
		for _, line := range lines {
			if strings.Contains(line, "main_test.go") {
				continue
			}
			bad = append(bad, line)
		}
		if len(bad) > 0 {
			t.Fatalf("forbidden stdout write call in shim source (Pitfall §6):\n%s",
				strings.Join(bad, "\n"))
		}
	}
}
