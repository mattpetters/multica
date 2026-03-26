package main

import (
	"context"
	"errors"
	"os/signal"
	"syscall"

	"github.com/spf13/cobra"

	"github.com/multica-ai/multica/server/internal/cli"
	"github.com/multica-ai/multica/server/internal/daemon"
	logger_pkg "github.com/multica-ai/multica/server/internal/logger"
)

var daemonCmd = &cobra.Command{
	Use:   "daemon",
	Short: "Run the local agent runtime daemon",
	Long:  "Start the daemon process that polls for tasks and executes them using local agent CLIs (Claude, Codex).",
	RunE:  runDaemon,
}

func init() {
	f := daemonCmd.Flags()
	f.String("daemon-id", "", "Unique daemon identifier (env: MULTICA_DAEMON_ID)")
	f.String("device-name", "", "Human-readable device name (env: MULTICA_DAEMON_DEVICE_NAME)")
	f.String("runtime-name", "", "Runtime display name (env: MULTICA_AGENT_RUNTIME_NAME)")
	f.Duration("poll-interval", 0, "Task poll interval (env: MULTICA_DAEMON_POLL_INTERVAL)")
	f.Duration("heartbeat-interval", 0, "Heartbeat interval (env: MULTICA_DAEMON_HEARTBEAT_INTERVAL)")
	f.Duration("agent-timeout", 0, "Per-task timeout (env: MULTICA_AGENT_TIMEOUT)")
}

func runDaemon(cmd *cobra.Command, _ []string) error {
	overrides := daemon.Overrides{
		ServerURL:   cli.FlagOrEnv(cmd, "server-url", "MULTICA_SERVER_URL", ""),
		DaemonID:    flagString(cmd, "daemon-id"),
		DeviceName:  flagString(cmd, "device-name"),
		RuntimeName: flagString(cmd, "runtime-name"),
	}
	if d, _ := cmd.Flags().GetDuration("poll-interval"); d > 0 {
		overrides.PollInterval = d
	}
	if d, _ := cmd.Flags().GetDuration("heartbeat-interval"); d > 0 {
		overrides.HeartbeatInterval = d
	}
	if d, _ := cmd.Flags().GetDuration("agent-timeout"); d > 0 {
		overrides.AgentTimeout = d
	}

	cfg, err := daemon.LoadConfig(overrides)
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	logger := logger_pkg.NewLogger("daemon")
	d := daemon.New(cfg, logger)

	if err := d.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
		return err
	}
	return nil
}

func flagString(cmd *cobra.Command, name string) string {
	val, _ := cmd.Flags().GetString(name)
	return val
}
