// Package execenv manages isolated per-task execution environments for the daemon.
// Each task gets its own directory with a git worktree (for code tasks) or plain
// directory (for non-code tasks), plus injected context files.
package execenv

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
)

// WorkspaceType indicates how the working directory was set up.
type WorkspaceType string

const (
	WorkspaceTypeGitWorktree WorkspaceType = "git_worktree"
	WorkspaceTypeDirectory   WorkspaceType = "directory"
)

// PrepareParams holds all inputs needed to set up an execution environment.
type PrepareParams struct {
	WorkspacesRoot string           // base path for all envs (e.g., ~/multica_workspaces)
	RepoPath       string           // source git repo path (for worktree creation), provided per-task by server
	TaskID         string           // task UUID — used for directory name
	AgentName      string           // for git branch naming only
	Task           TaskContextForEnv // context data for writing files
}

// TaskContextForEnv is the subset of task context used for writing context files.
type TaskContextForEnv struct {
	IssueTitle         string
	IssueDescription   string
	AcceptanceCriteria []string
	ContextRefs        []string
	WorkspaceContext   string
	AgentName          string
	AgentSkills        []SkillContextForEnv
}

// SkillContextForEnv represents a skill to be written into the execution environment.
type SkillContextForEnv struct {
	Name    string
	Content string
	Files   []SkillFileContextForEnv
}

// SkillFileContextForEnv represents a supporting file within a skill.
type SkillFileContextForEnv struct {
	Path    string
	Content string
}

// Environment represents a prepared, isolated execution environment.
type Environment struct {
	// RootDir is the top-level env directory ({workspacesRoot}/{task_id_short}/).
	RootDir string
	// WorkDir is the directory to pass as Cwd to the agent ({RootDir}/workdir/).
	WorkDir string
	// Type indicates git_worktree or directory.
	Type WorkspaceType
	// BranchName is the git branch name (empty for directory type).
	BranchName string

	gitRoot string      // source repo root (for cleanup)
	logger  *slog.Logger // for cleanup logging
}

// Prepare creates an isolated execution environment for a task.
func Prepare(params PrepareParams, logger *slog.Logger) (*Environment, error) {
	if params.WorkspacesRoot == "" {
		return nil, fmt.Errorf("execenv: workspaces root is required")
	}
	if params.TaskID == "" {
		return nil, fmt.Errorf("execenv: task ID is required")
	}

	envRoot := filepath.Join(params.WorkspacesRoot, shortID(params.TaskID))

	// Remove existing env if present (defensive — task IDs are unique).
	if _, err := os.Stat(envRoot); err == nil {
		if err := os.RemoveAll(envRoot); err != nil {
			return nil, fmt.Errorf("execenv: remove existing env: %w", err)
		}
	}

	// Create directory tree.
	workDir := filepath.Join(envRoot, "workdir")
	for _, dir := range []string{workDir, filepath.Join(envRoot, "output"), filepath.Join(envRoot, "logs")} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("execenv: create directory %s: %w", dir, err)
		}
	}

	env := &Environment{
		RootDir: envRoot,
		WorkDir: workDir,
		Type:    WorkspaceTypeDirectory,
		logger:  logger,
	}

	// Detect git repo and set up worktree if available.
	if params.RepoPath != "" {
		if gitRoot, ok := detectGitRepo(params.RepoPath); ok {
			branchName := fmt.Sprintf("agent/%s/%s", sanitizeName(params.AgentName), shortID(params.TaskID))

			// Get the default branch as base ref.
			baseRef := getDefaultBranch(gitRoot)

			if err := setupGitWorktree(gitRoot, workDir, branchName, baseRef); err != nil {
				logger.Warn("execenv: git worktree setup failed, falling back to directory mode", "error", err)
			} else {
				env.Type = WorkspaceTypeGitWorktree
				env.BranchName = branchName
				env.gitRoot = gitRoot

				// Exclude injected directories from git tracking.
				for _, pattern := range []string{".agent_context", ".claude", "AGENTS.md"} {
					if err := excludeFromGit(workDir, pattern); err != nil {
						logger.Warn("execenv: failed to exclude from git", "pattern", pattern, "error", err)
					}
				}
			}
		}
	}

	// Write context files into workdir.
	if err := writeContextFiles(workDir, params.Task); err != nil {
		return nil, fmt.Errorf("execenv: write context files: %w", err)
	}

	logger.Info("execenv: prepared env", "root", envRoot, "type", env.Type, "branch", env.BranchName)
	return env, nil
}

// Cleanup tears down the execution environment.
// If removeAll is true, the entire env root is deleted. Otherwise, workdir is
// removed but output/ and logs/ are preserved for debugging.
func (env *Environment) Cleanup(removeAll bool) error {
	if env == nil {
		return nil
	}

	// Remove git worktree first (must happen before directory deletion).
	if env.Type == WorkspaceTypeGitWorktree && env.gitRoot != "" {
		removeGitWorktree(env.gitRoot, env.WorkDir, env.BranchName, env.logger)
	}

	if removeAll {
		if err := os.RemoveAll(env.RootDir); err != nil {
			env.logger.Warn("execenv: cleanup removeAll failed", "error", err)
			return err
		}
		return nil
	}

	// Partial cleanup: remove workdir, keep output/ and logs/.
	if err := os.RemoveAll(env.WorkDir); err != nil {
		env.logger.Warn("execenv: cleanup workdir failed", "error", err)
		return err
	}
	return nil
}
