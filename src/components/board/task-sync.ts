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
