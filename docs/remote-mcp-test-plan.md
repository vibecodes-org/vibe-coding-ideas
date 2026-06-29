# Remote MCP Server — Test Plan

> **34 tools** — Last updated: February 2026

## Prerequisites

- `vibecodes` MCP server connected and authenticated
- VibeCodes account logged in via OAuth flow
- A "Claude to Code" label created on the VibeCodes board
- A "Ready to Test" column on the VibeCodes board

## 1. Connection & Discovery

### 1.1 Discovery endpoint returns metadata
- Visit `https://vibe-coding-ideas.vercel.app/.well-known/oauth-authorization-server`
- Should return JSON with issuer, endpoints, supported methods

### 1.2 Protected resource metadata
- Visit `https://vibe-coding-ideas.vercel.app/.well-known/oauth-protected-resource`
- Should return JSON pointing to `/api/mcp` resource

### 1.3 MCP connection via Claude Code
- Run `claude mcp add --transport http vibecodes https://vibe-coding-ideas.vercel.app/api/mcp`
- Restart Claude Code
- `/mcp` should show `vibecodes` as connected after browser OAuth login

---

## 2. Read Operations

### 2.1 List ideas
- Prompt: "List all my ideas on VibeCodes"
- Expected: Calls `list_ideas`, returns all ideas with titles, statuses, tags, counts

### 2.2 List ideas with filters
- Prompt: "List only in-progress ideas"
- Expected: Calls `list_ideas` with `status: "in_progress"`, returns only matching ideas

### 2.3 Search ideas
- Prompt: "Search for ideas about 'authentication'"
- Expected: Calls `list_ideas` with `search: "authentication"`, returns matching results

### 2.4 Get idea details
- Prompt: "Show me the details of the VibeCodes idea"
- Expected: Calls `get_idea`, returns description, recent comments, collaborators, board summary

### 2.5 Get board
- Prompt: "Show me the VibeCodes kanban board"
- Expected: Calls `get_board`, returns columns with tasks, labels, checklist progress

### 2.6 Get assigned tasks
- Prompt: "What are my assigned tasks across all ideas?"
- Expected: Calls `get_my_tasks`, returns tasks assigned to the authenticated user grouped by idea

### 2.7 Get task details
- Prompt: "Show me the details of task [task name]"
- Expected: Calls `get_task`, returns full task with checklist items, comments, activity log

### 2.8 List attachments
- Prompt: "Show me the attachments on that task"
- Expected: Calls `list_attachments`, returns file names with signed download URLs

### 2.9 List collaborators
- Prompt: "Who are the collaborators on the VibeCodes idea?"
- Expected: Calls `list_collaborators`, returns user names, emails, and joined dates

### 2.10 List notifications
- Prompt: "Show me my notifications"
- Expected: Calls `list_notifications`, returns notifications with actor names, idea titles, and unread count

### 2.11 List unread notifications only
- Prompt: "Show me only my unread notifications"
- Expected: Calls `list_notifications` with `unread_only: true`, returns only unread items

---

## 3. Task & Board Write Operations

### 3.1 Create a task
- Prompt: "Create a task on the VibeCodes board called 'Add dark mode toggle to landing page' in the To Do column"
- Expected: Calls `create_task`, task appears in the UI in the To Do column

### 3.2 Move a task
- Prompt: "Move that task to In Progress"
- Expected: Calls `move_task`, task moves to In Progress column in UI

### 3.3 Update a task
- Prompt: "Update that task description to include 'Should use next-themes toggle'"
- Expected: Calls `update_task`, description updated

### 3.4 Add a task comment
- Prompt: "Add a comment on that task saying 'Starting work on this'"
- Expected: Calls `add_task_comment`, comment appears in task detail dialog

### 3.5 Report a bug
- Prompt: "Create a bug report on the VibeCodes board: 'Login button unresponsive on Safari'"
- Expected: Calls `report_bug`, creates task with red "Bug" label

### 3.6 Manage labels
- Prompt: "Add the 'Claude to Code' label to that task"
- Expected: Calls `manage_labels` with `add_to_task` action

### 3.7 Create a new label
- Prompt: "Create a green label called 'Testing' on the VibeCodes board"
- Expected: Calls `manage_labels` with `create` action, label appears in board label list

### 3.8 Manage checklist
- Prompt: "Add a checklist item 'Write unit tests' to that task"
- Expected: Calls `manage_checklist` with `add` action, checklist item appears in task detail

### 3.9 Toggle checklist item
- Prompt: "Mark the 'Write unit tests' checklist item as done"
- Expected: Calls `manage_checklist` with `toggle` action, item shows as checked

### 3.10 Delete a task
- Prompt: "Delete the test task we just created"
- Expected: Calls `delete_task`, task removed from board

---

## 4. Idea Management Operations

### 4.1 Create an idea
- Prompt: "Create a new idea called 'Test Idea from MCP' with description 'Testing idea creation via MCP' and tags 'test, mcp'"
- Expected: Calls `create_idea`, idea appears in the feed with correct title, description, and tags

### 4.2 Update idea description
- Prompt: "Update the description of that idea to 'Updated via MCP remote server'"
- Expected: Calls `update_idea_description`, description updated in UI

### 4.3 Update idea status
- Prompt: "Mark that idea as in_progress"
- Expected: Calls `update_idea_status`, status badge changes in UI

### 4.4 Update idea tags
- Prompt: "Replace the tags on that idea with 'mcp, verified, remote'"
- Expected: Calls `update_idea_tags`, tags updated in UI

### 4.5 Add an idea comment
- Prompt: "Add a comment on that idea saying 'Testing remote MCP access'"
- Expected: Calls `add_idea_comment`, comment appears in UI

### 4.6 Delete an idea
- Prompt: "Delete the test idea we just created"
- Expected: Calls `delete_idea`, idea removed from feed
- Note: Only works for ideas you authored (or if you're an admin)

### 4.7 Cannot delete another user's idea
- Prompt: "Delete idea {someone-else's-idea-id}"
- Expected: Returns error — RLS blocks non-author deletion

---

## 5. Voting & Collaboration Operations

### 5.1 Toggle vote (add)
- Prompt: "Upvote the VibeCodes idea"
- Expected: Calls `toggle_vote`, vote count increases in UI

### 5.2 Toggle vote (remove)
- Prompt: "Remove my vote from the VibeCodes idea"
- Expected: Calls `toggle_vote` again, vote count decreases

### 5.3 Add collaborator
- Prompt: "Add user {user-id} as a collaborator on the VibeCodes idea"
- Expected: Calls `add_collaborator`, user appears in collaborator list
- Note: Requires knowing the user's UUID — typically done by the idea author

### 5.4 Remove collaborator
- Prompt: "Remove user {user-id} from the VibeCodes idea collaborators"
- Expected: Calls `remove_collaborator`, user removed from collaborator list

### 5.5 List collaborators
- Prompt: "Who are the collaborators on the VibeCodes idea?"
- Expected: Calls `list_collaborators`, returns names, emails, join dates

---

## 6. Column Management Operations

### 6.1 Create a column
- Prompt: "Add a new column called 'Review' to the VibeCodes board"
- Expected: Calls `create_column`, column appears at the end of the board

### 6.2 Create a done column
- Prompt: "Create a column called 'Shipped' and mark it as a done column"
- Expected: Calls `create_column` with `is_done_column: true`, column appears with done indicator

### 6.3 Update a column
- Prompt: "Rename the 'Review' column to 'Code Review'"
- Expected: Calls `update_column`, column title updated in UI

### 6.4 Reorder columns
- Prompt: "Reorder the columns so 'Code Review' comes between 'In Progress' and 'Done'"
- Expected: Calls `reorder_columns` with IDs in desired order, columns reorder in UI

### 6.5 Delete an empty column
- Prompt: "Delete the 'Code Review' column"
- Expected: Calls `delete_column`, column removed from board

### 6.6 Cannot delete column with tasks
- Prompt: "Delete the 'To Do' column" (when it has tasks)
- Expected: Returns error — "Cannot delete a column that has tasks"

---

## 7. Notification Operations

### 7.1 List all notifications
- Prompt: "Show me my notifications"
- Expected: Calls `list_notifications`, returns notifications with type, actor, idea, read status

### 7.2 List unread only
- Prompt: "Show me only unread notifications"
- Expected: Calls `list_notifications` with `unread_only: true`

### 7.3 Mark single notification read
- Prompt: "Mark that first notification as read"
- Expected: Calls `mark_notification_read`, notification's read status changes

### 7.4 Mark all read
- Prompt: "Mark all my notifications as read"
- Expected: Calls `mark_all_notifications_read`, all notifications become read
- Verify: Notification bell unread count drops to 0 in UI

---

## 8. Profile Operations

### 8.1 Update profile name
- Prompt: "Update my profile name to 'Test Name'"
- Expected: Calls `update_profile` with `full_name`, name changes in UI
- **Clean up**: Change back to original name after testing

### 8.2 Update bio
- Prompt: "Update my bio to 'Testing MCP profile updates'"
- Expected: Calls `update_profile` with `bio`, bio updated on profile page

### 8.3 Update GitHub username
- Prompt: "Set my GitHub username to 'test-user'"
- Expected: Calls `update_profile` with `github_username`, GitHub link updates on profile

### 8.4 Update multiple fields
- Prompt: "Update my bio to 'Full-stack dev' and my contact info to 'test@example.com'"
- Expected: Calls `update_profile` with both fields, both updated

---

## 9. Attribution Verification

### 9.1 Comments show real user name
- After test 4.5, check the VibeCodes idea comments in the browser
- Comment should show as posted by "Nick Ball" (your account), NOT "Claude Code Bot"

### 9.2 Task activity shows real user
- After test 3.1, open the task detail dialog and check the activity timeline
- Activity should show "Nick Ball created this task", not the bot

### 9.3 Task comments show real user
- After test 3.4, check the task comment in the detail dialog
- Should show your name as the author

### 9.4 Vote shows real user
- After test 5.1, the vote should be attributed to your account

---

## 10. RLS / Permissions Verification

### 10.1 Private idea not visible
- Have another user create a private idea
- Prompt: "Show me idea {their-private-idea-id}"
- Expected: Returns empty/error — RLS blocks access

### 10.2 Non-collaborator board access blocked
- Try to access a board for an idea you're not a collaborator or author on
- Expected: Blocked by `is_idea_team_member()` RLS policy

### 10.3 Cannot modify others' ideas
- Try: "Update the description of idea {someone-else's-idea-id}"
- Expected: Fails due to RLS owner-only update policy

### 10.4 Cannot delete others' ideas
- Try: "Delete idea {someone-else's-idea-id}"
- Expected: Fails due to RLS — `delete_idea` checks author/admin

### 10.5 Cannot modify others' profiles
- Note: `update_profile` uses `ctx.userId` so it always targets the authenticated user's own profile — cannot be used to modify others

---

## 11. Autonomous Workflow (the real value)

### 11.1 Pick up a labelled task
- Setup: Create a task labelled "Claude to Code" with a clear description
- Prompt: "Check the VibeCodes board for any tasks labelled 'Claude to Code'"
- Expected: Reads board, identifies the labelled task(s), reports back

### 11.2 Full task lifecycle
- Setup: A "Claude to Code" task with description and checklist
- Prompt: "Pick up the 'Claude to Code' task, move it to In Progress, implement it, add a comment with what you did, then move it to Ready to Test"
- Expected flow:
  1. `get_board` — reads the board
  2. `get_task` — reads task details, checklist, comments
  3. `move_task` — moves to In Progress
  4. `add_task_comment` — "Starting work on this"
  5. (writes code in the codebase)
  6. `add_task_comment` — summarizes changes
  7. `move_task` — moves to Ready to Test

### 11.3 Batch task processing
- Setup: Multiple tasks labelled "Claude to Code"
- Prompt: "Check the VibeCodes board, pick up all tasks labelled 'Claude to Code', and work through them one by one"
- Expected: Reads board, identifies multiple tasks, processes them sequentially with the lifecycle above

### 11.4 Bug fixing workflow
- Setup: Tasks labelled "Bug" with reproduction steps in description
- Prompt: "Look at the bug reports on the VibeCodes board and fix them"
- Expected: Filters for Bug-labelled tasks, reads details, implements fixes, moves to Ready to Test

### 11.5 Task refinement
- Setup: A vague task like "Improve the landing page"
- Prompt: "Read the task 'Improve the landing page', break it down into subtasks using the checklist, then start working on the first item"
- Expected: `get_task` → `manage_checklist` (adds items) → implements first checklist item → `manage_checklist` (toggles complete)

### 11.6 Cross-idea awareness
- Prompt: "List all in-progress ideas, check their boards, and give me a status update on what's left to do"
- Expected: `list_ideas` (filtered by in_progress) → `get_board` for each → summarizes remaining tasks

### 11.7 Full idea lifecycle via MCP
- Prompt: "Create an idea called 'Test Feature', add a board with columns, create tasks, add labels, assign tasks, work through them, and mark the idea as completed when done"
- Expected flow:
  1. `create_idea` — creates the idea
  2. `get_board` — auto-initializes columns
  3. `create_column` — adds custom columns if needed
  4. `create_task` (multiple) — adds tasks
  5. `manage_labels` — creates and assigns labels
  6. `update_task` — assigns tasks
  7. `move_task` — moves through workflow
  8. `add_task_comment` — documents progress
  9. `update_idea_status` — marks idea as completed

### 11.8 Notification-driven workflow
- Prompt: "Check my unread notifications, summarize what happened, and mark them all as read"
- Expected: `list_notifications` (unread_only) → summarizes → `mark_all_notifications_read`

### 11.9 Board reorganization
- Prompt: "Add a 'Backlog' column before 'To Do' and a 'QA' column between 'In Progress' and 'Done', then reorder them"
- Expected: `create_column` (x2) → `reorder_columns` with desired order

