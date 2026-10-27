// Paged and chunked reads shared by the admin step report and the get_cost_report
// MCP tool. A plain read stops at 1,000 rows without an error, and a large
// `.in()` list silently comes back empty, so reads page and chunk.

const PAGE = 1000;
const CHUNK = 100;

/** Reads every page: a plain read stops at 1,000 rows without an error. */
export async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

/** Large `.in()` lists come back empty at scale, so they go in chunks. */
export async function readByIds<T>(
  ids: string[],
  read: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await read(ids.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
  }
  return rows;
}

/** readByIds for reads that can pass 1,000 rows in one chunk. */
export async function readAllByIds<T>(
  ids: string[],
  page: (chunk: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    rows.push(...(await readAll<T>((from, to) => page(chunk, from, to))));
  }
  return rows;
}
