import { log } from '../../utils/logger';
import { detectErrorType } from './recovery';

export interface SessionRecoveryOptions {
  /** Max recovery attempts per session (default: 3) */
  maxAttempts?: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Creates a session-recovery hook.
 *
 * Listens for session error events, detects the error type,
 * and attempts recovery for known error patterns.
 *
 * Currently supports:
 * - tool_result_missing: injects stub tool_result parts
 *
 * Exposes the hook as `{ event }` for the plugin event system.
 */
export function createSessionRecoveryHook(
  options: SessionRecoveryOptions = {},
) {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  /** Track recovery attempts per session to avoid infinite loops. */
  const attemptCounts = new Map<string, number>();

  return {
    event: (input: {
      event: {
        type: string;
        properties?: Record<string, unknown>;
      };
    }) => {
      const { type, properties } = input.event;

      if (type !== 'session.status') return;

      const statusType = (properties as { status?: { type: string } })?.status
        ?.type;
      if (statusType !== 'error') return;

      const sessionID = (properties as { sessionID?: string })?.sessionID;
      if (!sessionID) return;

      const errorMessage =
        ((properties as { error?: string })?.error ??
          (properties as { status?: { message?: string } })?.status?.message) ||
        '';

      const errorType = detectErrorType(errorMessage);

      log('[session-recovery] Error detected', {
        sessionID,
        errorType,
        errorMessage: errorMessage.slice(0, 200),
      });

      if (errorType === 'unknown') return;

      // Check attempt budget
      const attempts = attemptCounts.get(sessionID) ?? 0;
      if (attempts >= maxAttempts) {
        log('[session-recovery] Max attempts reached', {
          sessionID,
          attempts,
        });
        return;
      }
      attemptCounts.set(sessionID, attempts + 1);

      if (errorType === 'tool_result_missing') {
        // In slim mode, we only log the detection and expose
        // recoverToolResultMissing for callers who have access
        // to the message array. We avoid filesystem surgery on
        // OpenCode internal storage in this first stage.
        log(
          '[session-recovery] tool_result_missing detected; ' +
            'recovery available via recoverToolResultMissing()',
          { sessionID },
        );
        return;
      }

      // Future: handle context_window_exceeded, rate_limit, etc.
      log('[session-recovery] No automatic recovery for type', {
        errorType,
        sessionID,
      });
    },
  };
}
