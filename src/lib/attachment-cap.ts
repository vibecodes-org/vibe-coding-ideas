// Pure helper for enforcing an attachment-count cap when a user selects or
// drops multiple files at once. Kept side-effect free so the slicing logic
// (and its boundary conditions) can be unit tested without mounting a
// component or mocking Supabase.
//
// `inFlight` accounts for uploads already in progress from a previous,
// not-yet-settled call — needed because the upload handler can be invoked
// again (paste, drop, file-picker) before earlier uploads finish and update
// the persisted attachment count.

export interface AcceptFilesResult {
  accepted: File[];
  rejectedCount: number;
}

export function acceptFilesWithinCap(
  currentCount: number,
  inFlight: number,
  files: File[] | FileList,
  max: number
): AcceptFilesResult {
  const fileArray = Array.from(files);
  const remaining = Math.max(0, max - currentCount - inFlight);
  const accepted = fileArray.slice(0, remaining);
  const rejectedCount = fileArray.length - accepted.length;

  return { accepted, rejectedCount };
}
