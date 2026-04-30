"use client";

import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@multica/ui/lib/utils";
import { ContentEditor, type ContentEditorRef } from "../../editor";
import { SubmitButton } from "@multica/ui/components/common/submit-button";
import { useChatStore, DRAFT_NEW_SESSION } from "@multica/core/chat";
import { createLogger } from "@multica/core/logger";

const logger = createLogger("chat.ui");

/** Maximum number of messages that can be queued while the agent is running. */
const MAX_QUEUED = 10;

interface ChatInputProps {
  onSend: (content: string) => void;
  onStop?: () => void;
  isRunning?: boolean;
  disabled?: boolean;
  /** True when the user has no agent available — disables the editor and
   *  surfaces a distinct placeholder. Kept separate from `disabled` so
   *  archived-session copy stays untouched. */
  noAgent?: boolean;
  /** Name of the currently selected agent, used in the placeholder. */
  agentName?: string;
  /** Rendered at the bottom-left of the input bar — typically the agent picker. */
  leftAdornment?: ReactNode;
  /** Rendered just before the submit button — used for context-anchor action. */
  rightAdornment?: ReactNode;
  /** Rendered inside the rounded container, above the editor — attached
   *  context cards, drafts, etc. */
  topSlot?: ReactNode;
}

export function ChatInput({
  onSend,
  onStop,
  isRunning,
  disabled,
  noAgent,
  agentName,
  leftAdornment,
  rightAdornment,
  topSlot,
}: ChatInputProps) {
  const editorRef = useRef<ContentEditorRef>(null);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const selectedAgentId = useChatStore((s) => s.selectedAgentId);
  const queuedMessages = useChatStore((s) => s.queuedMessages);
  const removeQueuedMessage = useChatStore((s) => s.removeQueuedMessage);
  const clearQueue = useChatStore((s) => s.clearQueue);
  // Scope the new-chat draft by agent:
  //   1. Switching agents while composing a brand-new chat gives each
  //      agent its own draft (no cross-agent leakage).
  //   2. Tiptap's Placeholder extension is only applied at mount; this
  //      key changes on agent switch so the editor remounts and the
  //      `Tell {agent} what to do…` placeholder refreshes.
  const draftKey =
    activeSessionId ?? `${DRAFT_NEW_SESSION}:${selectedAgentId ?? ""}`;
  // Select a primitive — empty-string fallback keeps referential stability.
  const inputDraft = useChatStore((s) => s.inputDrafts[draftKey] ?? "");
  const setInputDraft = useChatStore((s) => s.setInputDraft);
  const clearInputDraft = useChatStore((s) => s.clearInputDraft);
  const [isEmpty, setIsEmpty] = useState(!inputDraft.trim());

  const queueCount = queuedMessages.length;
  const queueFull = queueCount >= MAX_QUEUED;

  const handleSend = () => {
    const content = editorRef.current?.getMarkdown()?.replace(/(\n\s*)+$/, "").trim();
    if (!content || disabled || noAgent) {
      logger.debug("input.send skipped", {
        emptyContent: !content,
        isRunning,
        disabled,
        noAgent,
      });
      return;
    }

    // Enforce queue cap when running — toast is optional, no-op is fine.
    if (isRunning && queueFull) {
      logger.warn("input.send skipped: queue full", { queueCount });
      return;
    }

    // Capture draft key BEFORE onSend — creating a new session mutates
    // activeSessionId synchronously, so reading it after onSend would point
    // at the new session and leave the old draft orphaned.
    const keyAtSend = draftKey;
    logger.info("input.send", {
      contentLength: content.length,
      draftKey: keyAtSend,
      queued: !!isRunning,
    });
    onSend(content);
    editorRef.current?.clearContent();
    clearInputDraft(keyAtSend);
    setIsEmpty(true);

    // When not running, blur so the caret doesn't blink under the StatusPill.
    // When running (queuing), keep focus so the user can continue typing.
    if (!isRunning) {
      editorRef.current?.blur();
    }
  };

  const placeholder = noAgent
    ? "Create an agent to start chatting"
    : disabled
      ? "This session is archived"
      : isRunning
        ? "Type to queue a follow-up…"
        : agentName
          ? `Tell ${agentName} what to do…`
          : "Tell me what to do…";

  return (
    <div
      className={cn(
        "px-5 pb-3 pt-0",
        noAgent && "cursor-not-allowed",
      )}
    >
      <div
        className={cn(
          "relative mx-auto flex min-h-16 max-h-40 w-full max-w-4xl flex-col rounded-lg bg-card pb-9 border-1 border-border transition-colors focus-within:border-brand",
          noAgent && "pointer-events-none opacity-60",
        )}
        aria-disabled={noAgent || undefined}
      >
        {topSlot}

        {/* Queued messages indicator — shown above the editor when ≥ 1 message is waiting */}
        {queueCount > 0 && (
          <div className="flex flex-col gap-1 px-3 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {queueCount} queued
              </span>
              <button
                type="button"
                onClick={clearQueue}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear all
              </button>
            </div>
            {queuedMessages.map((msg, i) => (
              <div
                key={`q-${i}`}
                className="group flex items-start gap-1.5 rounded-md bg-accent/50 px-2 py-1 text-xs text-muted-foreground"
              >
                <span className="flex-1 truncate">{msg}</span>
                <button
                  type="button"
                  onClick={() => removeQueuedMessage(i)}
                  className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                  aria-label="Remove queued message"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
          <ContentEditor
            // Remount the editor when the active session changes so its
            // uncontrolled defaultValue picks up the new session's draft.
            key={draftKey}
            ref={editorRef}
            defaultValue={inputDraft}
            placeholder={placeholder}
            onUpdate={(md) => {
              setIsEmpty(!md.trim());
              setInputDraft(draftKey, md);
            }}
            onSubmit={handleSend}
            debounceMs={100}
            // Chat is short-form — the floating formatting toolbar is
            // more distraction than feature here.
            showBubbleMenu={false}
            // Enter sends; Shift-Enter inserts a hard break.
            submitOnEnter
          />
        </div>
        {leftAdornment && (
          <div className="absolute bottom-1.5 left-2 flex items-center">
            {leftAdornment}
          </div>
        )}
        <div className="absolute bottom-1 right-1.5 flex items-center gap-2">
          {rightAdornment}
          {/* Queue badge — shown inline next to submit when running + queue has items */}
          {isRunning && queueCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
              {queueCount} queued
            </span>
          )}
          <SubmitButton
            onClick={handleSend}
            disabled={isEmpty || !!disabled || !!noAgent || queueFull}
            running={isRunning}
            onStop={onStop}
          />
        </div>
      </div>
    </div>
  );
}
