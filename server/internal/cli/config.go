package cli

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const defaultCLIConfigPath = ".multica/config.json"

// WatchedWorkspace represents a workspace the daemon should monitor for tasks.
type WatchedWorkspace struct {
	ID   string `json:"id"`
	Name string `json:"name,omitempty"`
}

// CLIConfig holds persistent CLI settings.
type CLIConfig struct {
	ServerURL          string             `json:"server_url,omitempty"`
	WorkspaceID        string             `json:"workspace_id,omitempty"`
	Token              string             `json:"token,omitempty"`
	WatchedWorkspaces  []WatchedWorkspace `json:"watched_workspaces,omitempty"`
}

// AddWatchedWorkspace adds a workspace to the watch list. Returns true if added.
func (c *CLIConfig) AddWatchedWorkspace(id, name string) bool {
	for _, w := range c.WatchedWorkspaces {
		if w.ID == id {
			return false
		}
	}
	c.WatchedWorkspaces = append(c.WatchedWorkspaces, WatchedWorkspace{ID: id, Name: name})
	return true
}

// RemoveWatchedWorkspace removes a workspace from the watch list. Returns true if found.
func (c *CLIConfig) RemoveWatchedWorkspace(id string) bool {
	for i, w := range c.WatchedWorkspaces {
		if w.ID == id {
			c.WatchedWorkspaces = append(c.WatchedWorkspaces[:i], c.WatchedWorkspaces[i+1:]...)
			return true
		}
	}
	return false
}

// CLIConfigPath returns the default path for the CLI config file.
func CLIConfigPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve CLI config path: %w", err)
	}
	return filepath.Join(home, defaultCLIConfigPath), nil
}

// LoadCLIConfig reads the CLI config from disk.
func LoadCLIConfig() (CLIConfig, error) {
	path, err := CLIConfigPath()
	if err != nil {
		return CLIConfig{}, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return CLIConfig{}, nil
		}
		return CLIConfig{}, fmt.Errorf("read CLI config: %w", err)
	}
	var cfg CLIConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return CLIConfig{}, fmt.Errorf("parse CLI config: %w", err)
	}
	return cfg, nil
}

// SaveCLIConfig writes the CLI config to disk atomically (write to temp, then rename).
func SaveCLIConfig(cfg CLIConfig) error {
	path, err := CLIConfigPath()
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create CLI config directory: %w", err)
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("encode CLI config: %w", err)
	}

	// Write to a temp file in the same directory, then rename for atomicity.
	tmp, err := os.CreateTemp(dir, ".config-*.json.tmp")
	if err != nil {
		return fmt.Errorf("create temp config file: %w", err)
	}
	tmpPath := tmp.Name()
	if _, err := tmp.Write(append(data, '\n')); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("write temp config file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("close temp config file: %w", err)
	}
	if err := os.Chmod(tmpPath, 0o600); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("chmod temp config file: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("rename config file: %w", err)
	}
	return nil
}
