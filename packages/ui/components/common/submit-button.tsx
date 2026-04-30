"use client";

import { ArrowUp, Loader2, Square } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";

interface SubmitButtonProps {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  running?: boolean;
  onStop?: () => void;
}

function SubmitButton({ onClick, disabled, loading, running, onStop }: SubmitButtonProps) {
  if (running) {
    return (
      <div className="flex items-center gap-1">
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={disabled}
          onClick={onClick}
          aria-label="Send (queued)"
        >
          <ArrowUp />
        </Button>
        <Button size="icon-sm" onClick={onStop} aria-label="Stop">
          <Square className="fill-current" />
        </Button>
      </div>
    );
  }

  return (
    <Button size="icon-sm" disabled={disabled || loading} onClick={onClick}>
      {loading ? (
        <Loader2 className="animate-spin" />
      ) : (
        <ArrowUp />
      )}
    </Button>
  );
}

export { SubmitButton, type SubmitButtonProps };
