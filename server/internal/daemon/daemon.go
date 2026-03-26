package daemon

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/multica-ai/multica/server/internal/cli"
	"github.com/multica-ai/multica/server/internal/daemon/execenv"
	"github.com/multica-ai/multica/server/pkg/agent"
)

// workspaceState tracks registered runtimes for a single workspace.
type workspaceState struct {
	workspaceID string
	runtimeIDs  []string
}

// Daemon is the local agent runtime that polls for and executes tasks.
type Daemon struct {
	cfg    Config
	client *Client
	logger *slog.Logger

	mu         sync.Mutex
	workspaces map[string]*workspaceState
	reloading  sync.Mutex // prevents concurrent reloadWorkspaces
}

// New creates a new Daemon instance.
func New(cfg Config, logger *slog.Logger) *Daemon {
	return &Daemon{
		cfg:        cfg,
		client:     NewClient(cfg.ServerBaseURL),
		logger:     logger,
		workspaces: make(map[string]*workspaceState),
	}
}

// Run starts the daemon: resolves auth, registers runtimes, then polls for tasks.
func (d *Daemon) Run(ctx context.Context) error {
	agentNames := make([]string, 0, len(d.cfg.Agents))
	for name := range d.cfg.Agents {
		agentNames = append(agentNames, name)
	}
	d.logger.Info("starting daemon", "agents", agentNames, "server", d.cfg.ServerBaseURL)

	// Load auth token from CLI config.
	if err := d.resolveAuth(); err != nil {
		return err
	}

	// Load and register watched workspaces.
	if err := d.loadWatchedWorkspaces(ctx); err != nil {
		return err
	}

	runtimeIDs := d.allRuntimeIDs()
	if len(runtimeIDs) == 0 {
		return fmt.Errorf("no runtimes registered")
	}

	// Start config watcher for hot-reload.
	go d.configWatchLoop(ctx)

	go d.heartbeatLoop(ctx)
	return d.pollLoop(ctx)
}

// resolveAuth loads the auth token from the CLI config.
func (d *Daemon) resolveAuth() error {
	cfg, err := cli.LoadCLIConfig()
	if err != nil {
		return fmt.Errorf("load CLI config: %w", err)
	}
	if cfg.Token == "" {
		d.logger.Warn("not authenticated — run 'multica auth login' to authenticate, then restart the daemon")
		return fmt.Errorf("not authenticated: run 'multica auth login' first")
	}
	d.client.SetToken(cfg.Token)
	d.logger.Info("authenticated")
	return nil
}

// loadWatchedWorkspaces reads watched workspaces from CLI config and registers runtimes.
func (d *Daemon) loadWatchedWorkspaces(ctx context.Context) error {
	cfg, err := cli.LoadCLIConfig()
	if err != nil {
		return fmt.Errorf("load CLI config: %w", err)
	}

	if len(cfg.WatchedWorkspaces) == 0 {
		return fmt.Errorf("no watched workspaces configured: run 'multica watch <id>' to add one")
	}

	var registered int
	for _, ws := range cfg.WatchedWorkspaces {
		runtimes, err := d.registerRuntimesForWorkspace(ctx, ws.ID)
		if err != nil {
			d.logger.Error("failed to register runtimes", "workspace_id", ws.ID, "name", ws.Name, "error", err)
			continue
		}
		runtimeIDs := make([]string, len(runtimes))
		for i, rt := range runtimes {
			runtimeIDs[i] = rt.ID
			d.logger.Info("registered runtime", "workspace_id", ws.ID, "runtime_id", rt.ID, "provider", rt.Provider)
		}
		d.mu.Lock()
		d.workspaces[ws.ID] = &workspaceState{workspaceID: ws.ID, runtimeIDs: runtimeIDs}
		d.mu.Unlock()
		d.logger.Info("watching workspace", "workspace_id", ws.ID, "name", ws.Name, "runtimes", len(runtimes))
		registered++
	}

	if registered == 0 {
		return fmt.Errorf("failed to register runtimes for any of the %d watched workspace(s)", len(cfg.WatchedWorkspaces))
	}
	return nil
}

// allRuntimeIDs returns all runtime IDs across all watched workspaces.
func (d *Daemon) allRuntimeIDs() []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	var ids []string
	for _, ws := range d.workspaces {
		ids = append(ids, ws.runtimeIDs...)
	}
	return ids
}

func (d *Daemon) registerRuntimesForWorkspace(ctx context.Context, workspaceID string) ([]Runtime, error) {
	var runtimes []map[string]string
	for name, entry := range d.cfg.Agents {
		version, err := agent.DetectVersion(ctx, entry.Path)
		if err != nil {
			d.logger.Warn("skip registering runtime", "name", name, "error", err)
			continue
		}
		runtimes = append(runtimes, map[string]string{
			"name":    fmt.Sprintf("Local %s", strings.ToUpper(name[:1])+name[1:]),
			"type":    name,
			"version": version,
			"status":  "online",
		})
	}
	if len(runtimes) == 0 {
		return nil, fmt.Errorf("no agent runtimes could be registered")
	}

	req := map[string]any{
		"workspace_id": workspaceID,
		"daemon_id":    d.cfg.DaemonID,
		"device_name":  d.cfg.DeviceName,
		"runtimes":     runtimes,
	}

	rts, err := d.client.Register(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("register runtimes: %w", err)
	}
	if len(rts) == 0 {
		return nil, fmt.Errorf("register runtimes: empty response")
	}
	return rts, nil
}

// configWatchLoop periodically checks for config file changes and reloads workspaces.
func (d *Daemon) configWatchLoop(ctx context.Context) {
	configPath, err := cli.CLIConfigPath()
	if err != nil {
		d.logger.Warn("cannot watch config file", "error", err)
		return
	}

	var lastModTime time.Time
	if info, err := os.Stat(configPath); err == nil {
		lastModTime = info.ModTime()
	}

	ticker := time.NewTicker(DefaultConfigReloadInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			info, err := os.Stat(configPath)
			if err != nil {
				continue
			}
			if !info.ModTime().After(lastModTime) {
				continue
			}
			lastModTime = info.ModTime()
			d.reloadWorkspaces(ctx)
		}
	}
}

// reloadWorkspaces reconciles the active workspace set with the config file.
// NOTE: Token changes (e.g. re-login as a different user) are not picked up;
// the daemon must be restarted for a new auth token to take effect.
func (d *Daemon) reloadWorkspaces(ctx context.Context) {
	d.reloading.Lock()
	defer d.reloading.Unlock()

	cfg, err := cli.LoadCLIConfig()
	if err != nil {
		d.logger.Warn("reload config failed", "error", err)
		return
	}

	newIDs := make(map[string]string) // id -> name
	for _, ws := range cfg.WatchedWorkspaces {
		newIDs[ws.ID] = ws.Name
	}

	d.mu.Lock()
	currentIDs := make(map[string]bool)
	for id := range d.workspaces {
		currentIDs[id] = true
	}
	d.mu.Unlock()

	// Register runtimes for newly added workspaces.
	for id, name := range newIDs {
		if !currentIDs[id] {
			runtimes, err := d.registerRuntimesForWorkspace(ctx, id)
			if err != nil {
				d.logger.Error("register runtimes for new workspace failed", "workspace_id", id, "error", err)
				continue
			}
			runtimeIDs := make([]string, len(runtimes))
			for i, rt := range runtimes {
				runtimeIDs[i] = rt.ID
			}
			d.mu.Lock()
			d.workspaces[id] = &workspaceState{workspaceID: id, runtimeIDs: runtimeIDs}
			d.mu.Unlock()
			d.logger.Info("now watching workspace", "workspace_id", id, "name", name)
		}
	}

	// Remove workspaces no longer in config.
	// NOTE: runtimes are not deregistered server-side; they will go offline
	// after heartbeats stop arriving (within HeartbeatInterval).
	for id := range currentIDs {
		if _, ok := newIDs[id]; !ok {
			d.mu.Lock()
			delete(d.workspaces, id)
			d.mu.Unlock()
			d.logger.Info("stopped watching workspace", "workspace_id", id)
		}
	}
}

func (d *Daemon) heartbeatLoop(ctx context.Context) {
	ticker := time.NewTicker(d.cfg.HeartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			for _, rid := range d.allRuntimeIDs() {
				if err := d.client.SendHeartbeat(ctx, rid); err != nil {
					d.logger.Warn("heartbeat failed", "runtime_id", rid, "error", err)
				}
			}
		}
	}
}

func (d *Daemon) pollLoop(ctx context.Context) error {
	pollOffset := 0
	pollCount := 0
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		runtimeIDs := d.allRuntimeIDs()
		if len(runtimeIDs) == 0 {
			if err := sleepWithContext(ctx, d.cfg.PollInterval); err != nil {
				return err
			}
			continue
		}

		claimed := false
		n := len(runtimeIDs)
		for i := 0; i < n; i++ {
			rid := runtimeIDs[(pollOffset+i)%n]
			task, err := d.client.ClaimTask(ctx, rid)
			if err != nil {
				d.logger.Warn("claim task failed", "runtime_id", rid, "error", err)
				continue
			}
			if task != nil {
				d.logger.Info("task received", "task_id", task.ID, "issue_id", task.IssueID, "title", task.Context.Issue.Title)
				d.handleTask(ctx, *task)
				claimed = true
				pollOffset = (pollOffset + i + 1) % n
				break
			}
		}

		if !claimed {
			pollCount++
			if pollCount%20 == 1 {
				d.logger.Debug("poll: no tasks", "runtimes", runtimeIDs, "cycle", pollCount)
			}
			pollOffset = (pollOffset + 1) % n
			if err := sleepWithContext(ctx, d.cfg.PollInterval); err != nil {
				return err
			}
		} else {
			pollCount = 0
		}
	}
}

func (d *Daemon) handleTask(ctx context.Context, task Task) {
	provider := task.Context.Runtime.Provider
	d.logger.Info("picked task", "task_id", task.ID, "issue_id", task.IssueID, "provider", provider, "title", task.Context.Issue.Title)

	if err := d.client.StartTask(ctx, task.ID); err != nil {
		d.logger.Error("start task failed", "task_id", task.ID, "error", err)
		return
	}

	_ = d.client.ReportProgress(ctx, task.ID, fmt.Sprintf("Launching %s", provider), 1, 2)

	result, err := d.runTask(ctx, task)
	if err != nil {
		d.logger.Error("task failed", "task_id", task.ID, "error", err)
		if failErr := d.client.FailTask(ctx, task.ID, err.Error()); failErr != nil {
			d.logger.Error("fail task callback failed", "task_id", task.ID, "error", failErr)
		}
		return
	}

	_ = d.client.ReportProgress(ctx, task.ID, "Finishing task", 2, 2)

	switch result.Status {
	case "blocked":
		if err := d.client.FailTask(ctx, task.ID, result.Comment); err != nil {
			d.logger.Error("report blocked task failed", "task_id", task.ID, "error", err)
		}
	default:
		d.logger.Info("task completed", "task_id", task.ID, "status", result.Status)
		if err := d.client.CompleteTask(ctx, task.ID, result.Comment, result.BranchName); err != nil {
			d.logger.Error("complete task failed", "task_id", task.ID, "error", err)
		}
	}
}

func (d *Daemon) runTask(ctx context.Context, task Task) (TaskResult, error) {
	provider := task.Context.Runtime.Provider
	entry, ok := d.cfg.Agents[provider]
	if !ok {
		return TaskResult{}, fmt.Errorf("no agent configured for provider %q", provider)
	}

	// Prepare isolated execution environment.
	taskCtx := execenv.TaskContextForEnv{
		IssueTitle:         task.Context.Issue.Title,
		IssueDescription:   task.Context.Issue.Description,
		AcceptanceCriteria: task.Context.Issue.AcceptanceCriteria,
		ContextRefs:        task.Context.Issue.ContextRefs,
		WorkspaceContext:   task.Context.WorkspaceContext,
		AgentName:          task.Context.Agent.Name,
		AgentSkills:        convertSkillsForEnv(task.Context.Agent.Skills),
	}
	env, err := execenv.Prepare(execenv.PrepareParams{
		WorkspacesRoot: d.cfg.WorkspacesRoot,
		RepoPath:       task.Context.RepoPath,
		TaskID:         task.ID,
		AgentName:      task.Context.Agent.Name,
		Task:           taskCtx,
	}, d.logger)
	if err != nil {
		return TaskResult{}, fmt.Errorf("prepare execution environment: %w", err)
	}

	// Inject runtime-specific config (meta skill) so the agent discovers .agent_context/.
	if err := execenv.InjectRuntimeConfig(env.WorkDir, provider, taskCtx); err != nil {
		d.logger.Warn("execenv: inject runtime config failed (non-fatal)", "error", err)
	}
	defer func() {
		if cleanupErr := env.Cleanup(!d.cfg.KeepEnvAfterTask); cleanupErr != nil {
			d.logger.Warn("cleanup env failed", "task_id", task.ID, "error", cleanupErr)
		}
	}()

	prompt := BuildPrompt(task)

	backend, err := agent.New(provider, agent.Config{
		ExecutablePath: entry.Path,
		Logger:         d.logger,
	})
	if err != nil {
		return TaskResult{}, fmt.Errorf("create agent backend: %w", err)
	}

	d.logger.Info("starting agent", "provider", provider, "task_id", task.ID, "workdir", env.WorkDir, "branch", env.BranchName, "env_type", env.Type, "model", entry.Model, "timeout", d.cfg.AgentTimeout.String())

	session, err := backend.Execute(ctx, prompt, agent.ExecOptions{
		Cwd:     env.WorkDir,
		Model:   entry.Model,
		Timeout: d.cfg.AgentTimeout,
	})
	if err != nil {
		return TaskResult{}, err
	}

	// Drain message channel (log tool uses, ignore text since Result has output)
	go func() {
		for msg := range session.Messages {
			switch msg.Type {
			case agent.MessageToolUse:
				d.logger.Debug("tool-use", "provider", provider, "tool", msg.Tool, "call_id", msg.CallID)
			case agent.MessageError:
				d.logger.Error("agent error", "provider", provider, "content", msg.Content)
			}
		}
	}()

	result := <-session.Result

	switch result.Status {
	case "completed":
		if result.Output == "" {
			return TaskResult{}, fmt.Errorf("%s returned empty output", provider)
		}
		return TaskResult{
			Status:     "completed",
			Comment:    result.Output,
			BranchName: env.BranchName,
			EnvType:    string(env.Type),
		}, nil
	case "timeout":
		return TaskResult{}, fmt.Errorf("%s timed out after %s", provider, d.cfg.AgentTimeout)
	default:
		errMsg := result.Error
		if errMsg == "" {
			errMsg = fmt.Sprintf("%s execution %s", provider, result.Status)
		}
		return TaskResult{Status: "blocked", Comment: errMsg}, nil
	}
}

func convertSkillsForEnv(skills []SkillData) []execenv.SkillContextForEnv {
	if len(skills) == 0 {
		return nil
	}
	result := make([]execenv.SkillContextForEnv, len(skills))
	for i, s := range skills {
		result[i] = execenv.SkillContextForEnv{
			Name:    s.Name,
			Content: s.Content,
		}
		for _, f := range s.Files {
			result[i].Files = append(result[i].Files, execenv.SkillFileContextForEnv{
				Path:    f.Path,
				Content: f.Content,
			})
		}
	}
	return result
}
