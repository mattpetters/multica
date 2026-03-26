package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var (
	version = "dev"
	commit  = "unknown"
)

var rootCmd = &cobra.Command{
	Use:   "multica",
	Short: "Multica CLI — local agent runtime and management tool",
	Long:  "multica manages local agent runtimes and provides control commands for the Multica platform.",
	SilenceUsage:  true,
	SilenceErrors: true,
}

func init() {
	rootCmd.PersistentFlags().String("server-url", "", "Multica server URL (env: MULTICA_SERVER_URL)")
	rootCmd.PersistentFlags().String("workspace-id", "", "Workspace ID (env: MULTICA_WORKSPACE_ID)")

	rootCmd.AddCommand(authCmd)
	rootCmd.AddCommand(daemonCmd)
	rootCmd.AddCommand(agentCmd)
	rootCmd.AddCommand(runtimeCmd)
	rootCmd.AddCommand(workspaceCmd)
	rootCmd.AddCommand(watchCmd)
	rootCmd.AddCommand(unwatchCmd)
	rootCmd.AddCommand(watchesCmd)
	rootCmd.AddCommand(configCmd)
	rootCmd.AddCommand(statusCmd)
	rootCmd.AddCommand(versionCmd)
}

func main() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
		os.Exit(1)
	}
}
