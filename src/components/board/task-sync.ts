/**
 * Decides whether an externally-changed task field (delivered via a `task` prop
 * update — e.g. a debounced Realtime board refresh) should overwrite the local
 * editable copy in the task detail dialog.
 *
 * Returning `false` while the user is editing OR while a save for that field is
 * in flight prevents a stale prop value from clobbering freshly-typed text — the
 * "description update bug" where blurring to save occasionally lost characters.
 */
export function shouldSyncFieldFromProp(params: {
  /** The value arriving on the `task` prop. */
  incoming: string | null;
  /** The last prop value we synced into local state. */
  lastSynced: string | null;
  /** True while the user is actively editing this field. */
  isEditing?: boolean;
  /** True while a save for this field is in flight. */
  isSaving?: boolean;
}): boolean {
  const { incoming, lastSynced, isEditing = false, isSaving = false } = params;
  if (incoming === lastSynced) return false;
  if (isEditing) return false;
  if (isSaving) return false;
  return true;
}

/**
 * Decides whether a debounced/auto-save should actually persist a field value.
 *
 * The task detail dialog mirrors the `task` prop into a local editable buffer AND
 * runs a debounced auto-save off that same buffer. A Realtime board refresh can
 * write a *stale* server value back into the buffer (e.g. a partial save's refresh
 * arriving late on a slow connection). If the auto-save then fires, it would
 * re-persist that stale value over newer content — the data-loss in the
 * "description update bug".
 *
 * The fix: only persist values that originated from **user input** (`dirty`),
 * never values the prop-sync wrote into the buffer. `dirty` must be set true on
 * user keystrokes and false whenever the buffer is set from the prop.
 */
export function shouldPersistFieldEdit(params: {
  /** True only when the buffer's current value came from user input (not a prop-sync). */
  dirty: boolean;
  /** The value about to be saved (already trimmed/normalised). */
  nextValue: string | null;
  /** The value currently persisted on the server (`task.<field>`). */
  serverValue: string | null;
}): boolean {
  const { dirty, nextValue, serverValue } = params;
  if (!dirty) return false; // never persist a prop-synced / external value
  if (nextValue === serverValue) return false; // no-op, already saved
  return true;
}
