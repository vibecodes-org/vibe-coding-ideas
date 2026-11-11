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

/** Rows per request the database returns at most (Supabase default `max-rows`).
 * A query with no `.range()` silently stops here, with no error. */
export const DB_PAGE_SIZE = 1000;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Load EVERY row of a query by paging with `.range()`, because a bare select
 * stops silently at `DB_PAGE_SIZE` rows. `buildPage(from, to)` must return the
 * query with `.range(from, to)` applied and a TOTAL order (e.g. `.order("position")`
 * then `.order("id")`) so rows cannot repeat or skip across pages. Pages are
 * fetched one after another (the end is only known when a page comes back short).
 * Returns the first error as-is instead of a partial list.
 */
export async function fetchAllRows<T>(
  buildPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize: number = DB_PAGE_SIZE
): Promise<PageResult<T>> {
  if (pageSize <= 0) throw new Error("fetchAllRows: pageSize must be > 0");
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildPage(from, from + pageSize - 1);
    if (error) return { data: null, error };
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) return { data: all, error: null };
  }
}
