-- The webhook trigger hand-picked seven columns into its payload (00047):
-- id, user_id, actor_id, type, idea_id, comment_id, task_id. Every column
-- added to `notifications` since then has been silently dropped on the way to
-- the email route — `discussion_id` (00060), `reply_id`, and most recently
-- `task_comment_id` (00166), which is why the task-mention fix landed inert:
-- the route never received the id it needed and fell through to the
-- description branch, mislabelling a comment as a description edit.
--
-- Send the whole row instead. `to_jsonb(new)` cannot omit a column, so a
-- future column can never be lost here again — which is the actual bug; the
-- missing ids were only its symptoms.
create or replace function public.send_notification_email()
returns trigger as $$
declare
  webhook_url text;
  webhook_secret text;
begin
  webhook_url := 'https://vibecodes.co.uk/api/notifications/email';

  -- Read secret from Supabase Vault
  select decrypted_secret into webhook_secret
  from vault.decrypted_secrets
  where name = 'notification_webhook_secret'
  limit 1;

  -- Skip if no secret configured (prevents sending in local dev)
  if webhook_secret is null or webhook_secret = '' then
    return new;
  end if;

  -- Queue async HTTP POST via pg_net
  perform net.http_post(
    url := webhook_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || webhook_secret
    ),
    body := jsonb_build_object('record', to_jsonb(new))
  );

  return new;
end;
$$ language plpgsql security definer;
