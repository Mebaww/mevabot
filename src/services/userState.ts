// In-memory conversation state for interactive multi-step commands (/proposal, /remind).

export type PendingAction =
  | { type: 'awaiting_proposal' }
  | { type: 'awaiting_remind' };

interface StateEntry {
  action: PendingAction;
  timestamp: number;
}

const states = new Map<number, StateEntry>();
const TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes timeout

export function setPendingAction(userId: number, action: PendingAction): void {
  states.set(userId, { action, timestamp: Date.now() });
}

export function getPendingAction(userId: number): PendingAction | null {
  const entry = states.get(userId);
  if (!entry) return null;

  if (Date.now() - entry.timestamp > TIMEOUT_MS) {
    states.delete(userId);
    return null;
  }

  return entry.action;
}

export function clearPendingAction(userId: number): boolean {
  return states.delete(userId);
}
