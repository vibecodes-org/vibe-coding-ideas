/** Max id-list length for a single Supabase `.in()` filter. Larger lists build a
 * long querystring URL that can silently return empty for authenticated requests
 * at scale (see the board-labels incident). Keep batches well under the limit. */
export const IN_FILTER_CHUNK_SIZE = 100;

/** Split ids into fixed-size chunks (last may be smaller) so a bulk `.in()` query
 * stays under the URL-length limit. */
export function chunkIds<T>(ids: readonly T[], size: number = IN_FILTER_CHUNK_SIZE): T[][] {
  if (size <= 0) throw new Error("chunkIds: size must be > 0");
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}
