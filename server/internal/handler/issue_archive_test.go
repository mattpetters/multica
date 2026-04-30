package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// ---------------------------------------------------------------------------
// Archive endpoint tests
// ---------------------------------------------------------------------------

func TestArchiveIssue(t *testing.T) {
	id := createTestIssue(t, "archive-happy", "todo", "medium")
	t.Cleanup(func() { deleteTestIssue(t, id) })

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/issues/"+id+"/archive", nil)
	req = withURLParam(req, "id", id)
	testHandler.ArchiveIssue(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp IssueResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if resp.ArchivedAt == nil {
		t.Fatal("expected archived_at to be set, got nil")
	}
	if resp.ID != id {
		t.Fatalf("expected id %s, got %s", id, resp.ID)
	}
}

func TestArchiveIssueAlreadyArchived(t *testing.T) {
	id := createTestIssue(t, "archive-conflict", "todo", "medium")
	t.Cleanup(func() { deleteTestIssue(t, id) })

	// Archive first time
	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/issues/"+id+"/archive", nil)
	req = withURLParam(req, "id", id)
	testHandler.ArchiveIssue(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("first archive: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Archive again — should return 409
	w = httptest.NewRecorder()
	req = newRequest("POST", "/api/issues/"+id+"/archive", nil)
	req = withURLParam(req, "id", id)
	testHandler.ArchiveIssue(w, req)
	if w.Code != http.StatusConflict {
		t.Fatalf("second archive: expected 409, got %d: %s", w.Code, w.Body.String())
	}
}

func TestArchiveIssueNotFound(t *testing.T) {
	w := httptest.NewRecorder()
	fakeID := "00000000-0000-0000-0000-000000000000"
	req := newRequest("POST", "/api/issues/"+fakeID+"/archive", nil)
	req = withURLParam(req, "id", fakeID)
	testHandler.ArchiveIssue(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

// ---------------------------------------------------------------------------
// Restore endpoint tests
// ---------------------------------------------------------------------------

func TestRestoreIssue(t *testing.T) {
	id := createTestIssue(t, "restore-happy", "todo", "medium")
	t.Cleanup(func() { deleteTestIssue(t, id) })

	// Archive first
	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/issues/"+id+"/archive", nil)
	req = withURLParam(req, "id", id)
	testHandler.ArchiveIssue(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("archive: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Restore
	w = httptest.NewRecorder()
	req = newRequest("POST", "/api/issues/"+id+"/restore", nil)
	req = withURLParam(req, "id", id)
	testHandler.RestoreIssue(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("restore: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp IssueResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if resp.ArchivedAt != nil {
		t.Fatalf("expected archived_at to be nil after restore, got %v", *resp.ArchivedAt)
	}
	if resp.ID != id {
		t.Fatalf("expected id %s, got %s", id, resp.ID)
	}
}

func TestRestoreIssueNotArchived(t *testing.T) {
	id := createTestIssue(t, "restore-conflict", "todo", "medium")
	t.Cleanup(func() { deleteTestIssue(t, id) })

	// Restore without archiving first — should return 409
	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/issues/"+id+"/restore", nil)
	req = withURLParam(req, "id", id)
	testHandler.RestoreIssue(w, req)
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", w.Code, w.Body.String())
	}
}

func TestRestoreIssueNotFound(t *testing.T) {
	w := httptest.NewRecorder()
	fakeID := "00000000-0000-0000-0000-000000000000"
	req := newRequest("POST", "/api/issues/"+fakeID+"/restore", nil)
	req = withURLParam(req, "id", fakeID)
	testHandler.RestoreIssue(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

// ---------------------------------------------------------------------------
// Query behavior: archived issues excluded from standard queries
// ---------------------------------------------------------------------------

func TestArchivedIssueExcludedFromListIssues(t *testing.T) {
	id := createTestIssue(t, "archive-list-excl", "todo", "low")
	t.Cleanup(func() { deleteTestIssue(t, id) })

	// Verify issue appears in list before archiving
	assertIssueInList(t, id, true)

	// Archive it
	archiveIssue(t, id)

	// Verify issue no longer appears in list
	assertIssueInList(t, id, false)
}

func TestArchivedIssueExcludedFromListOpenIssues(t *testing.T) {
	id := createTestIssue(t, "archive-open-excl", "in_progress", "low")
	t.Cleanup(func() { deleteTestIssue(t, id) })

	// Verify issue appears in open list before archiving
	assertIssueInOpenList(t, id, true)

	// Archive it
	archiveIssue(t, id)

	// Verify issue no longer appears in open list
	assertIssueInOpenList(t, id, false)
}

func TestArchivedIssueExcludedFromCountIssues(t *testing.T) {
	id := createTestIssue(t, "archive-count-excl", "todo", "low")
	t.Cleanup(func() { deleteTestIssue(t, id) })

	countBefore := getIssueCount(t)

	// Archive it
	archiveIssue(t, id)

	countAfter := getIssueCount(t)
	if countAfter >= countBefore {
		t.Fatalf("expected count to decrease after archive: before=%d, after=%d", countBefore, countAfter)
	}
}

func TestRestoredIssueReappearsInListIssues(t *testing.T) {
	id := createTestIssue(t, "archive-restore-list", "todo", "low")
	t.Cleanup(func() { deleteTestIssue(t, id) })

	archiveIssue(t, id)
	assertIssueInList(t, id, false)

	// Restore
	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/issues/"+id+"/restore", nil)
	req = withURLParam(req, "id", id)
	testHandler.RestoreIssue(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("restore: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	assertIssueInList(t, id, true)
}

// ---------------------------------------------------------------------------
// WebSocket event tests
// ---------------------------------------------------------------------------

func TestArchiveIssuePublishesEvent(t *testing.T) {
	id := createTestIssue(t, "archive-event", "todo", "medium")
	t.Cleanup(func() { deleteTestIssue(t, id) })

	gotPayload := make(chan map[string]any, 1)
	testHandler.Bus.Subscribe(protocol.EventIssueArchived, func(e events.Event) {
		if payload, ok := e.Payload.(map[string]any); ok {
			select {
			case gotPayload <- payload:
			default:
			}
		}
	})

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/issues/"+id+"/archive", nil)
	req = withURLParam(req, "id", id)
	testHandler.ArchiveIssue(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	select {
	case payload := <-gotPayload:
		issue, ok := payload["issue"].(map[string]any)
		if !ok {
			t.Fatal("event payload missing 'issue' key")
		}
		if issue["id"] != id {
			t.Fatalf("event issue id = %v; want %s", issue["id"], id)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive issue:archived event within timeout")
	}
}

func TestRestoreIssuePublishesEvent(t *testing.T) {
	id := createTestIssue(t, "restore-event", "todo", "medium")
	t.Cleanup(func() { deleteTestIssue(t, id) })

	// Archive first
	archiveIssue(t, id)

	gotPayload := make(chan map[string]any, 1)
	testHandler.Bus.Subscribe(protocol.EventIssueRestored, func(e events.Event) {
		if payload, ok := e.Payload.(map[string]any); ok {
			select {
			case gotPayload <- payload:
			default:
			}
		}
	})

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/issues/"+id+"/restore", nil)
	req = withURLParam(req, "id", id)
	testHandler.RestoreIssue(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	select {
	case payload := <-gotPayload:
		issue, ok := payload["issue"].(map[string]any)
		if !ok {
			t.Fatal("event payload missing 'issue' key")
		}
		if issue["id"] != id {
			t.Fatalf("event issue id = %v; want %s", issue["id"], id)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive issue:restored event within timeout")
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func archiveIssue(t *testing.T, id string) {
	t.Helper()
	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/issues/"+id+"/archive", nil)
	req = withURLParam(req, "id", id)
	testHandler.ArchiveIssue(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("archiveIssue helper: expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func assertIssueInList(t *testing.T, issueID string, shouldExist bool) {
	t.Helper()
	w := httptest.NewRecorder()
	req := newRequest("GET", "/api/issues?workspace_id="+testWorkspaceID+"&limit=200", nil)
	testHandler.ListIssues(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListIssues: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var listResp struct {
		Issues []IssueResponse `json:"issues"`
	}
	json.NewDecoder(w.Body).Decode(&listResp)

	found := false
	for _, issue := range listResp.Issues {
		if issue.ID == issueID {
			found = true
			break
		}
	}
	if shouldExist && !found {
		t.Fatalf("expected issue %s to be in list, but it was not", issueID)
	}
	if !shouldExist && found {
		t.Fatalf("expected issue %s to NOT be in list, but it was", issueID)
	}
}

func assertIssueInOpenList(t *testing.T, issueID string, shouldExist bool) {
	t.Helper()
	w := httptest.NewRecorder()
	req := newRequest("GET", "/api/issues?workspace_id="+testWorkspaceID+"&open_only=true", nil)
	testHandler.ListIssues(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListIssues(open_only): expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var listResp struct {
		Issues []IssueResponse `json:"issues"`
	}
	json.NewDecoder(w.Body).Decode(&listResp)

	found := false
	for _, issue := range listResp.Issues {
		if issue.ID == issueID {
			found = true
			break
		}
	}
	if shouldExist && !found {
		t.Fatalf("expected issue %s to be in open list, but it was not", issueID)
	}
	if !shouldExist && found {
		t.Fatalf("expected issue %s to NOT be in open list, but it was", issueID)
	}
}

func getIssueCount(t *testing.T) int {
	t.Helper()
	w := httptest.NewRecorder()
	req := newRequest("GET", "/api/issues?workspace_id="+testWorkspaceID+"&limit=1", nil)
	testHandler.ListIssues(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListIssues(count): expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Total int `json:"total"`
	}
	json.NewDecoder(w.Body).Decode(&resp)
	return resp.Total
}
