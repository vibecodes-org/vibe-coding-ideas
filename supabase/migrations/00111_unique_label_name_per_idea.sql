-- Prevent duplicate label names per idea (case-insensitive)
-- First, deduplicate any existing duplicates by keeping the oldest label
-- and reassigning task_label references + auto-rules to the survivor

DO $$
DECLARE
  dup RECORD;
  survivor_id UUID;
BEGIN
  -- Find groups of duplicate labels (same idea_id + lowercase name)
  FOR dup IN
    SELECT idea_id, lower(name) AS lname, min(created_at) AS earliest
    FROM board_labels
    GROUP BY idea_id, lower(name)
    HAVING count(*) > 1
  LOOP
    -- Get the survivor (oldest label in the group)
    SELECT id INTO survivor_id
    FROM board_labels
    WHERE idea_id = dup.idea_id AND lower(name) = dup.lname
    ORDER BY created_at ASC
    LIMIT 1;

    -- Reassign task-label links from duplicates to the survivor
    UPDATE board_task_labels
    SET label_id = survivor_id
    WHERE label_id IN (
      SELECT id FROM board_labels
      WHERE idea_id = dup.idea_id AND lower(name) = dup.lname AND id != survivor_id
    )
    AND NOT EXISTS (
      -- Avoid unique violation if task already has the survivor label
      SELECT 1 FROM board_task_labels existing
      WHERE existing.task_id = board_task_labels.task_id AND existing.label_id = survivor_id
    );

    -- Delete orphaned task-label links (task already had survivor label)
    DELETE FROM board_task_labels
    WHERE label_id IN (
      SELECT id FROM board_labels
      WHERE idea_id = dup.idea_id AND lower(name) = dup.lname AND id != survivor_id
    );

    -- Reassign workflow auto-rules from duplicates to the survivor
    UPDATE workflow_auto_rules
    SET label_id = survivor_id
    WHERE label_id IN (
      SELECT id FROM board_labels
      WHERE idea_id = dup.idea_id AND lower(name) = dup.lname AND id != survivor_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM workflow_auto_rules existing
      WHERE existing.label_id = survivor_id AND existing.template_id = workflow_auto_rules.template_id
    );

    -- Delete orphaned auto-rules (survivor already has same template mapping)
    DELETE FROM workflow_auto_rules
    WHERE label_id IN (
      SELECT id FROM board_labels
      WHERE idea_id = dup.idea_id AND lower(name) = dup.lname AND id != survivor_id
    );

    -- Delete the duplicate labels
    DELETE FROM board_labels
    WHERE idea_id = dup.idea_id AND lower(name) = dup.lname AND id != survivor_id;
  END LOOP;
END $$;

-- Now add the unique index
CREATE UNIQUE INDEX board_labels_idea_id_name_unique
ON board_labels (idea_id, lower(name));
