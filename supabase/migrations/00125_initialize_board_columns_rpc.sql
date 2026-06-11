-- Make board-column initialisation RACE-SAFE.
--
-- Bug: initializeBoardColumns() in src/actions/board.ts did a check-then-insert
-- with NO atomicity guard ("if no columns exist, insert the defaults"). The board
-- page server-renders this on visit; when the page is requested twice concurrently
-- (Next.js prefetch + navigation hit the dynamic route before either commits),
-- BOTH calls saw "no columns" and BOTH inserted the full default set → every column
-- duplicated (Backlog, Backlog, To Do, To Do, …).
--
-- Fix: do the check + insert inside one DB function guarded by a per-idea advisory
-- lock, so concurrent initialisation for the same idea is serialised — only the
-- first caller inserts; the rest see the columns already exist and return.
-- SECURITY INVOKER (default) → RLS on board_columns is still enforced as the caller,
-- so only idea team members can initialise (matches the prior server-action check).

create or replace function public.initialize_board_columns(
  p_idea_id uuid,
  p_columns jsonb
)
returns void
language plpgsql
as $$
begin
  -- Serialise concurrent initialisation for the same idea.
  perform pg_advisory_xact_lock(hashtext('init_board_columns:' || p_idea_id::text));

  -- Already initialised (or another caller just won the race) → nothing to do.
  if exists (select 1 from board_columns where idea_id = p_idea_id) then
    return;
  end if;

  insert into board_columns (idea_id, title, position, is_done_column)
  select
    p_idea_id,
    (c->>'title'),
    (c->>'position')::int,
    coalesce((c->>'is_done_column')::boolean, false)
  from jsonb_array_elements(p_columns) as c;
end;
$$;

grant execute on function public.initialize_board_columns(uuid, jsonb) to authenticated;
