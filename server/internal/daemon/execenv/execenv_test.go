package execenv

import (
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func testLogger() *slog.Logger {
	return slog.Default()
}

func TestShortID(t *testing.T) {
	t.Parallel()
	tests := []struct {
		input, want string
	}{
		{"a1b2c3d4-e5f6-7890-abcd-ef1234567890", "a1b2c3d4"},
		{"abcdef12", "abcdef12"},
		{"ab", "ab"},
		{"a1b2c3d4e5f67890", "a1b2c3d4"},
	}
	for _, tt := range tests {
		if got := shortID(tt.input); got != tt.want {
			t.Errorf("shortID(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestSanitizeName(t *testing.T) {
	t.Parallel()
	tests := []struct {
		input, want string
	}{
		{"Code Reviewer", "code-reviewer"},
		{"my_agent!@#v2", "my-agent-v2"},
		{"  spaces  ", "spaces"},
		{"UPPERCASE", "uppercase"},
		{"a-very-long-name-that-exceeds-thirty-characters-total", "a-very-long-name-that-exceeds"},
		{"", "agent"},
		{"---", "agent"},
		{"日本語テスト", "agent"},
	}
	for _, tt := range tests {
		if got := sanitizeName(tt.input); got != tt.want {
			t.Errorf("sanitizeName(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestDetectGitRepo(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()

	cmd := exec.Command("git", "init", dir)
	if err := cmd.Run(); err != nil {
		t.Skipf("git not available: %v", err)
	}

	root, ok := detectGitRepo(dir)
	if !ok {
		t.Fatal("expected git repo to be detected")
	}
	if root == "" {
		t.Fatal("expected non-empty git root")
	}

	// Subdirectory should also detect.
	subdir := filepath.Join(dir, "sub")
	os.MkdirAll(subdir, 0o755)
	root2, ok2 := detectGitRepo(subdir)
	if !ok2 {
		t.Fatal("expected subdirectory to detect git repo")
	}
	if root2 != root {
		t.Fatalf("expected same root, got %q vs %q", root2, root)
	}
}

func TestDetectGitRepoFalse(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	_, ok := detectGitRepo(dir)
	if ok {
		t.Fatal("expected non-git dir to return false")
	}
}

func TestPrepareDirectoryMode(t *testing.T) {
	t.Parallel()
	workspacesRoot := t.TempDir()
	reposRoot := t.TempDir() // not a git repo

	env, err := Prepare(PrepareParams{
		WorkspacesRoot: workspacesRoot,
		RepoPath:       reposRoot,
		TaskID:         "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
		AgentName:      "Test Agent",
		Task: TaskContextForEnv{
			IssueTitle:       "Fix the bug",
			IssueDescription: "There is a bug in the login flow.",
			AcceptanceCriteria: []string{
				"Login works",
				"Tests pass",
			},
			AgentSkills: []SkillContextForEnv{
				{Name: "Code Review", Content: "Be concise."},
			},
		},
	}, testLogger())
	if err != nil {
		t.Fatalf("Prepare failed: %v", err)
	}
	defer env.Cleanup(true)

	if env.Type != WorkspaceTypeDirectory {
		t.Fatalf("expected directory type, got %s", env.Type)
	}
	if env.BranchName != "" {
		t.Fatalf("expected empty branch name, got %s", env.BranchName)
	}

	// Verify directory structure.
	for _, sub := range []string{"workdir", "output", "logs"} {
		path := filepath.Join(env.RootDir, sub)
		if _, err := os.Stat(path); os.IsNotExist(err) {
			t.Fatalf("expected %s to exist", path)
		}
	}

	// Verify context file.
	content, err := os.ReadFile(filepath.Join(env.WorkDir, ".agent_context", "issue_context.md"))
	if err != nil {
		t.Fatalf("failed to read issue_context.md: %v", err)
	}
	for _, want := range []string{"Fix the bug", "login flow", "Login works", "Tests pass", "Code Review"} {
		if !strings.Contains(string(content), want) {
			t.Fatalf("issue_context.md missing %q", want)
		}
	}

	// Verify skill files.
	skillContent, err := os.ReadFile(filepath.Join(env.WorkDir, ".agent_context", "skills", "code-review", "SKILL.md"))
	if err != nil {
		t.Fatalf("failed to read SKILL.md: %v", err)
	}
	if !strings.Contains(string(skillContent), "Be concise.") {
		t.Fatal("SKILL.md missing content")
	}

}

func TestPrepareGitWorktreeMode(t *testing.T) {
	t.Parallel()

	// Create a temporary git repo with an initial commit.
	reposRoot := t.TempDir()
	for _, args := range [][]string{
		{"init", reposRoot},
		{"-C", reposRoot, "commit", "--allow-empty", "-m", "initial"},
	} {
		cmd := exec.Command("git", args...)
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=test", "GIT_AUTHOR_EMAIL=test@test.com",
			"GIT_COMMITTER_NAME=test", "GIT_COMMITTER_EMAIL=test@test.com",
		)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Skipf("git setup failed: %s: %v", out, err)
		}
	}

	workspacesRoot := t.TempDir()

	env, err := Prepare(PrepareParams{
		WorkspacesRoot: workspacesRoot,
		RepoPath:       reposRoot,
		TaskID:         "b2c3d4e5-f6a7-8901-bcde-f12345678901",
		AgentName:      "Code Reviewer",
		Task: TaskContextForEnv{
			IssueTitle:       "Add feature",
			IssueDescription: "Add a new feature.",
		},
	}, testLogger())
	if err != nil {
		t.Fatalf("Prepare failed: %v", err)
	}
	defer env.Cleanup(true)

	if env.Type != WorkspaceTypeGitWorktree {
		t.Fatalf("expected git_worktree type, got %s", env.Type)
	}
	if env.BranchName == "" {
		t.Fatal("expected non-empty branch name")
	}
	if !strings.HasPrefix(env.BranchName, "agent/code-reviewer/") {
		t.Fatalf("unexpected branch name: %s", env.BranchName)
	}

	// Verify worktree is listed.
	cmd := exec.Command("git", "-C", reposRoot, "worktree", "list")
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("git worktree list failed: %v", err)
	}
	if !strings.Contains(string(out), "workdir") {
		t.Fatalf("worktree not listed: %s", out)
	}

	// Verify context file exists in workdir.
	if _, err := os.Stat(filepath.Join(env.WorkDir, ".agent_context", "issue_context.md")); os.IsNotExist(err) {
		t.Fatal("expected .agent_context/issue_context.md to exist in workdir")
	}
}

func TestWriteContextFiles(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()

	ctx := TaskContextForEnv{
		IssueTitle:         "Test Issue",
		IssueDescription:   "A detailed description.",
		AcceptanceCriteria: []string{"Criterion A", "Criterion B"},
		ContextRefs:        []string{"ref-1", "ref-2"},
		WorkspaceContext:   "We use Go and TypeScript.",
		AgentSkills: []SkillContextForEnv{
			{
				Name:    "Go Conventions",
				Content: "Follow Go conventions.",
				Files: []SkillFileContextForEnv{
					{Path: "templates/example.go", Content: "package main"},
				},
			},
		},
	}

	if err := writeContextFiles(dir, ctx); err != nil {
		t.Fatalf("writeContextFiles failed: %v", err)
	}

	content, err := os.ReadFile(filepath.Join(dir, ".agent_context", "issue_context.md"))
	if err != nil {
		t.Fatalf("failed to read: %v", err)
	}

	s := string(content)
	for _, want := range []string{
		"# Issue: Test Issue",
		"## Description",
		"A detailed description.",
		"## Acceptance Criteria",
		"- Criterion A",
		"- Criterion B",
		"## Context References",
		"- ref-1",
		"## Workspace Context",
		"Go and TypeScript",
		"## Agent Skills",
		"Go Conventions",
	} {
		if !strings.Contains(s, want) {
			t.Errorf("content missing %q", want)
		}
	}

	// Verify skill directory and files.
	skillMd, err := os.ReadFile(filepath.Join(dir, ".agent_context", "skills", "go-conventions", "SKILL.md"))
	if err != nil {
		t.Fatalf("failed to read SKILL.md: %v", err)
	}
	if !strings.Contains(string(skillMd), "Follow Go conventions.") {
		t.Error("SKILL.md missing content")
	}

	supportFile, err := os.ReadFile(filepath.Join(dir, ".agent_context", "skills", "go-conventions", "templates", "example.go"))
	if err != nil {
		t.Fatalf("failed to read supporting file: %v", err)
	}
	if string(supportFile) != "package main" {
		t.Errorf("supporting file content = %q, want %q", string(supportFile), "package main")
	}
}

func TestWriteContextFilesOmitsEmpty(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()

	ctx := TaskContextForEnv{
		IssueTitle: "Minimal Issue",
	}

	if err := writeContextFiles(dir, ctx); err != nil {
		t.Fatalf("writeContextFiles failed: %v", err)
	}

	content, err := os.ReadFile(filepath.Join(dir, ".agent_context", "issue_context.md"))
	if err != nil {
		t.Fatalf("failed to read: %v", err)
	}

	s := string(content)
	if !strings.Contains(s, "Minimal Issue") {
		t.Error("expected title to be present")
	}
	for _, absent := range []string{"## Description", "## Acceptance Criteria", "## Context References", "## Workspace Context", "## Agent Skills"} {
		if strings.Contains(s, absent) {
			t.Errorf("expected %q to be omitted for empty content", absent)
		}
	}
}

func TestCleanupGitWorktree(t *testing.T) {
	t.Parallel()

	// Create a temp git repo.
	reposRoot := t.TempDir()
	for _, args := range [][]string{
		{"init", reposRoot},
		{"-C", reposRoot, "commit", "--allow-empty", "-m", "initial"},
	} {
		cmd := exec.Command("git", args...)
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=test", "GIT_AUTHOR_EMAIL=test@test.com",
			"GIT_COMMITTER_NAME=test", "GIT_COMMITTER_EMAIL=test@test.com",
		)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Skipf("git setup failed: %s: %v", out, err)
		}
	}

	workspacesRoot := t.TempDir()

	env, err := Prepare(PrepareParams{
		WorkspacesRoot: workspacesRoot,
		RepoPath:       reposRoot,
		TaskID:         "c3d4e5f6-a7b8-9012-cdef-123456789012",
		AgentName:      "Cleanup Test",
		Task:           TaskContextForEnv{IssueTitle: "Cleanup test"},
	}, testLogger())
	if err != nil {
		t.Fatalf("Prepare failed: %v", err)
	}

	branchName := env.BranchName
	rootDir := env.RootDir

	// Cleanup with removeAll=true.
	if err := env.Cleanup(true); err != nil {
		t.Fatalf("Cleanup failed: %v", err)
	}

	// Verify env root is removed.
	if _, err := os.Stat(rootDir); !os.IsNotExist(err) {
		t.Fatal("expected env root to be removed")
	}

	// Verify branch is deleted.
	cmd := exec.Command("git", "-C", reposRoot, "branch", "--list", branchName)
	out, _ := cmd.Output()
	if strings.TrimSpace(string(out)) != "" {
		t.Fatalf("expected branch %s to be deleted", branchName)
	}
}

func TestInjectRuntimeConfigClaude(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()

	ctx := TaskContextForEnv{
		IssueTitle: "Test Issue",
		AgentSkills: []SkillContextForEnv{
			{Name: "Go Conventions", Content: "Follow Go conventions.", Files: []SkillFileContextForEnv{
				{Path: "example.go", Content: "package main"},
			}},
			{Name: "PR Review", Content: "Review PRs carefully."},
		},
	}

	if err := InjectRuntimeConfig(dir, "claude", ctx); err != nil {
		t.Fatalf("InjectRuntimeConfig failed: %v", err)
	}

	content, err := os.ReadFile(filepath.Join(dir, ".claude", "CLAUDE.md"))
	if err != nil {
		t.Fatalf("failed to read .claude/CLAUDE.md: %v", err)
	}

	s := string(content)
	for _, want := range []string{
		"Multica Agent Runtime",
		".agent_context/issue_context.md",
		".agent_context/skills/",
		"Go Conventions",
		"PR Review",
		"go-conventions/SKILL.md",
		"pr-review/SKILL.md",
		"1 supporting files",
	} {
		if !strings.Contains(s, want) {
			t.Errorf("CLAUDE.md missing %q", want)
		}
	}
}

func TestInjectRuntimeConfigCodex(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()

	ctx := TaskContextForEnv{
		IssueTitle:  "Test Issue",
		AgentSkills: []SkillContextForEnv{{Name: "Coding", Content: "Write good code."}},
	}

	if err := InjectRuntimeConfig(dir, "codex", ctx); err != nil {
		t.Fatalf("InjectRuntimeConfig failed: %v", err)
	}

	content, err := os.ReadFile(filepath.Join(dir, "AGENTS.md"))
	if err != nil {
		t.Fatalf("failed to read AGENTS.md: %v", err)
	}

	s := string(content)
	if !strings.Contains(s, "Multica Agent Runtime") {
		t.Error("AGENTS.md missing meta skill header")
	}
	if !strings.Contains(s, "Coding") {
		t.Error("AGENTS.md missing skill name")
	}
}

func TestInjectRuntimeConfigNoSkills(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()

	ctx := TaskContextForEnv{IssueTitle: "Test Issue"}

	if err := InjectRuntimeConfig(dir, "claude", ctx); err != nil {
		t.Fatalf("InjectRuntimeConfig failed: %v", err)
	}

	content, err := os.ReadFile(filepath.Join(dir, ".claude", "CLAUDE.md"))
	if err != nil {
		t.Fatalf("failed to read .claude/CLAUDE.md: %v", err)
	}

	s := string(content)
	if !strings.Contains(s, "issue_context.md") {
		t.Error("should reference issue_context.md even without skills")
	}
	if strings.Contains(s, "## Skills") {
		t.Error("should not have Skills section when there are no skills")
	}
}

func TestInjectRuntimeConfigUnknownProvider(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()

	// Unknown provider should be a no-op.
	if err := InjectRuntimeConfig(dir, "unknown", TaskContextForEnv{}); err != nil {
		t.Fatalf("expected no error for unknown provider, got: %v", err)
	}

	// No files should be created.
	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Fatalf("expected empty dir for unknown provider, got %d entries", len(entries))
	}
}

func TestCleanupPreservesLogs(t *testing.T) {
	t.Parallel()
	workspacesRoot := t.TempDir()

	env, err := Prepare(PrepareParams{
		WorkspacesRoot: workspacesRoot,
		RepoPath:       t.TempDir(), // not a git repo
		TaskID:         "d4e5f6a7-b8c9-0123-defa-234567890123",
		AgentName:      "Preserve Test",
		Task:           TaskContextForEnv{IssueTitle: "Preserve test"},
	}, testLogger())
	if err != nil {
		t.Fatalf("Prepare failed: %v", err)
	}

	// Write something to logs/.
	os.WriteFile(filepath.Join(env.RootDir, "logs", "test.log"), []byte("log data"), 0o644)

	// Cleanup with removeAll=false.
	if err := env.Cleanup(false); err != nil {
		t.Fatalf("Cleanup failed: %v", err)
	}

	// workdir should be gone.
	if _, err := os.Stat(env.WorkDir); !os.IsNotExist(err) {
		t.Fatal("expected workdir to be removed")
	}

	// logs should still exist.
	logFile := filepath.Join(env.RootDir, "logs", "test.log")
	if _, err := os.Stat(logFile); os.IsNotExist(err) {
		t.Fatal("expected logs/test.log to be preserved")
	}
}
