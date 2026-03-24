import { z } from "zod";
import { VALID_LABEL_COLORS } from "../constants";
import { logActivity } from "../activity";
import type { McpContext } from "../context";
import { checkAndApplyAutoRules, checkAutoRuleWorkflow, removeAutoRuleWorkflow } from "../../../src/lib/workflow-helpers";
import { applyWorkflowTemplate } from "./workflows";

// --- manage_labels ---

export const manageLabelsSchema = z.object({
  idea_id: z.string().uuid().describe("The idea ID"),
  action: z
    .enum(["create", "add_to_task", "remove_from_task"])
    .describe("Action to perform"),
  // For "create"
  name: z.string().min(1).max(50).optional().describe("Label name (for create)"),
  color: z
    .string()
    .optional()
    .describe("Label color (for create): red, orange, amber, yellow, lime, green, blue, cyan, violet, purple, pink, rose, emerald, zinc"),
  // For "add_to_task" / "remove_from_task"
  task_id: z.string().uuid().optional().describe("Task ID (for add/remove)"),
  label_id: z
    .string()
    .uuid()
    .optional()
    .describe("Label ID (for add/remove)"),
  remove_workflow: z
    .boolean()
    .optional()
    .describe("When removing a label, also remove the workflow applied by an auto-rule for this label (default false)"),
});

export async function manageLabels(
  ctx: McpContext,
  params: z.infer<typeof manageLabelsSchema>
) {
  if (params.action === "create") {
    if (!params.name) throw new Error("name is required for create");
    const color = params.color ?? "blue";
    if (!VALID_LABEL_COLORS.includes(color)) {
      throw new Error(`Invalid color: ${color}. Valid: ${VALID_LABEL_COLORS.join(", ")}`);
    }

    const { data, error } = await ctx.supabase
      .from("board_labels")
      .insert({ idea_id: params.idea_id, name: params.name, color })
      .select("id, name, color")
      .single();

    if (error) throw new Error(`Failed to create label: ${error.message}`);
    return { success: true, label: data };
  }

  if (params.action === "add_to_task") {
    if (!params.task_id || !params.label_id)
      throw new Error("task_id and label_id are required for add_to_task");

    const { error } = await ctx.supabase
      .from("board_task_labels")
      .insert({ task_id: params.task_id, label_id: params.label_id });

    if (error) throw new Error(`Failed to add label: ${error.message}`);

    // Get label name for activity
    const { data: label } = await ctx.supabase
      .from("board_labels")
      .select("name")
      .eq("id", params.label_id)
      .single();

    await logActivity(ctx, params.task_id, params.idea_id, "label_added", {
      label_name: label?.name ?? params.label_id,
    });

    // Check for auto-rule workflow application
    await checkAndApplyAutoRules(
      ctx.supabase, params.task_id, params.label_id, params.idea_id,
      (taskId, templateId) => applyWorkflowTemplate(ctx, { task_id: taskId, template_id: templateId })
    );

    return { success: true };
  }

  if (params.action === "remove_from_task") {
    if (!params.task_id || !params.label_id)
      throw new Error("task_id and label_id are required for remove_from_task");

    // Get label name for activity
    const { data: label } = await ctx.supabase
      .from("board_labels")
      .select("name")
      .eq("id", params.label_id)
      .single();

    const { error } = await ctx.supabase
      .from("board_task_labels")
      .delete()
      .eq("task_id", params.task_id)
      .eq("label_id", params.label_id);

    if (error) throw new Error(`Failed to remove label: ${error.message}`);

    await logActivity(ctx, params.task_id, params.idea_id, "label_removed", {
      label_name: label?.name ?? params.label_id,
    });

    // Check for active auto-rule workflow associated with this label
    const workflowCheck = await checkAutoRuleWorkflow(
      ctx.supabase, params.task_id, params.label_id, params.idea_id
    );

    let workflowRemoved = false;
    if (workflowCheck.hasActiveWorkflow) {
      if (params.remove_workflow) {
        const result = await removeAutoRuleWorkflow(
          ctx.supabase, params.task_id, params.label_id, params.idea_id
        );
        workflowRemoved = result.removed;
      }
    }

    return {
      success: true,
      workflow_removed: workflowRemoved,
      ...(workflowCheck.hasActiveWorkflow && !workflowRemoved
        ? {
            has_active_workflow: true,
            workflow_template_name: workflowCheck.templateName,
            hint: `This label had an active workflow "${workflowCheck.templateName}" which was NOT removed. To also remove it, call again with remove_workflow: true.`,
          }
        : {}),
    };
  }

  throw new Error(`Unknown action: ${params.action}`);
}

