package daemon

// AgentEntry describes a single available agent CLI.
type AgentEntry struct {
	Path  string // path to CLI binary
	Model string // model override (optional)
}

// Runtime represents a registered daemon runtime.
type Runtime struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Provider string `json:"provider"`
	Status   string `json:"status"`
}

// Task represents a claimed task from the server.
type Task struct {
	ID      string      `json:"id"`
	AgentID string      `json:"agent_id"`
	IssueID string      `json:"issue_id"`
	Context TaskContext `json:"context"`
}

// TaskContext contains the snapshot context for a task.
type TaskContext struct {
	Issue            IssueContext   `json:"issue"`
	Agent            AgentContext   `json:"agent"`
	Runtime          RuntimeContext `json:"runtime"`
	WorkspaceContext string         `json:"workspace_context,omitempty"`
	RepoPath         string         `json:"repo_path,omitempty"`
}

// IssueContext holds issue details for task execution.
type IssueContext struct {
	ID                 string   `json:"id"`
	Title              string   `json:"title"`
	Description        string   `json:"description"`
	AcceptanceCriteria []string `json:"acceptance_criteria"`
	ContextRefs        []string `json:"context_refs"`
}

// AgentContext holds agent details for task execution.
type AgentContext struct {
	ID     string      `json:"id"`
	Name   string      `json:"name"`
	Skills []SkillData `json:"skills"`
}

// SkillData represents a structured skill in the task context.
type SkillData struct {
	Name    string          `json:"name"`
	Content string          `json:"content"`
	Files   []SkillFileData `json:"files,omitempty"`
}

// SkillFileData represents a supporting file within a skill.
type SkillFileData struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

// RuntimeContext holds runtime details for task execution.
type RuntimeContext struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Provider   string `json:"provider"`
	DeviceInfo string `json:"device_info"`
}

// TaskResult is the outcome of executing a task.
type TaskResult struct {
	Status     string `json:"status"`
	Comment    string `json:"comment"`
	BranchName string `json:"branch_name,omitempty"`
	EnvType    string `json:"env_type,omitempty"`
}
