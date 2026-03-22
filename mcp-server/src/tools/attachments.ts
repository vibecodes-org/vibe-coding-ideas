import { z } from "zod";
import { randomUUID } from "crypto";
import { logger } from "../../../src/lib/logger";
import { logActivity } from "../activity";
import type { McpContext } from "../context";

const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/html",
  "application/zip",
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// --- list_attachments ---

export const listAttachmentsSchema = z.object({
  task_id: z.string().uuid().describe("The task ID"),
  idea_id: z.string().uuid().describe("The idea ID"),
});

export async function listAttachments(
  ctx: McpContext,
  params: z.infer<typeof listAttachmentsSchema>
) {
  const { data: attachments, error } = await ctx.supabase
    .from("board_task_attachments")
    .select("*, users!board_task_attachments_uploaded_by_fkey(full_name)")
    .eq("task_id", params.task_id)
    .eq("idea_id", params.idea_id)
    .order("created_at");

  if (error) throw new Error(`Failed to list attachments: ${error.message}`);

  // Generate signed URLs for each attachment
  const result = await Promise.all(
    (attachments ?? []).map(async (att) => {
      const { data: urlData } = await ctx.supabase.storage
        .from("task-attachments")
        .createSignedUrl(att.storage_path, 3600); // 1 hour

      return {
        id: att.id,
        file_name: att.file_name,
        file_size: att.file_size,
        content_type: att.content_type,
        storage_path: att.storage_path,
        created_at: att.created_at,
        uploaded_by: (att as Record<string, unknown>).users ?? null,
        url: urlData?.signedUrl ?? null,
      };
    })
  );

  return result;
}

// --- upload_attachment ---

export const uploadAttachmentSchema = z.object({
  task_id: z.string().uuid().describe("The task ID"),
  idea_id: z.string().uuid().describe("The idea ID"),
  file_name: z.string().min(1).max(255).describe("The file name including extension"),
  content_type: z.string().min(1).describe("MIME content type (e.g. image/png, application/pdf)"),
  data: z.string().min(1).describe("Base64-encoded file content"),
});

export async function uploadAttachment(
  ctx: McpContext,
  params: z.infer<typeof uploadAttachmentSchema>
) {
  // Validate content type
  if (!ALLOWED_CONTENT_TYPES.includes(params.content_type)) {
    throw new Error(
      `Content type "${params.content_type}" not allowed. Allowed types: ${ALLOWED_CONTENT_TYPES.join(", ")}`
    );
  }

  // Decode base64
  const buffer = Buffer.from(params.data, "base64");

  // Validate file size
  if (buffer.byteLength > MAX_FILE_SIZE) {
    throw new Error(
      `File size ${buffer.byteLength} bytes exceeds maximum of ${MAX_FILE_SIZE} bytes (10MB)`
    );
  }

  // Extract extension from file name
  const lastDot = params.file_name.lastIndexOf(".");
  const ext = lastDot > 0 ? params.file_name.slice(lastDot + 1) : "bin";

  // Generate storage path
  const storagePath = `${params.idea_id}/${params.task_id}/${randomUUID()}.${ext}`;

  // Upload to storage
  const { error: uploadError } = await ctx.supabase.storage
    .from("task-attachments")
    .upload(storagePath, buffer, {
      contentType: params.content_type,
      upsert: false,
    });

  if (uploadError) throw new Error(`Failed to upload file: ${uploadError.message}`);

  // Insert DB row
  const { data: attachment, error: dbError } = await ctx.supabase
    .from("board_task_attachments")
    .insert({
      task_id: params.task_id,
      idea_id: params.idea_id,
      uploaded_by: ctx.userId,
      file_name: params.file_name,
      file_size: buffer.byteLength,
      content_type: params.content_type,
      storage_path: storagePath,
    })
    .select("id, file_name, storage_path")
    .single();

  if (dbError) {
    // Clean up uploaded file on DB failure
    await ctx.supabase.storage.from("task-attachments").remove([storagePath]);
    throw new Error(`Failed to save attachment record: ${dbError.message}`);
  }

  // Run post-upload operations in parallel for speed
  const [, , urlResult] = await Promise.all([
    // Auto-set cover image if first image upload
    params.content_type.startsWith("image/")
      ? ctx.supabase
          .from("board_tasks")
          .select("cover_image_path")
          .eq("id", params.task_id)
          .single()
          .then(({ data: task }) => {
            if (!task?.cover_image_path) {
              return ctx.supabase
                .from("board_tasks")
                .update({ cover_image_path: storagePath })
                .eq("id", params.task_id);
            }
          })
      : Promise.resolve(),
    // Log activity
    logActivity(ctx, params.task_id, params.idea_id, "attachment_added", {
      file_name: params.file_name,
    }),
    // Generate signed URL for the response
    ctx.supabase.storage
      .from("task-attachments")
      .createSignedUrl(storagePath, 3600),
  ]);

  return {
    success: true,
    attachment: {
      id: attachment.id,
      file_name: attachment.file_name,
      storage_path: attachment.storage_path,
      url: urlResult.data?.signedUrl ?? null,
    },
  };
}

// --- delete_attachment ---

export const deleteAttachmentSchema = z.object({
  attachment_id: z.string().uuid().describe("The attachment ID"),
  task_id: z.string().uuid().describe("The task ID"),
  idea_id: z.string().uuid().describe("The idea ID"),
});

export async function deleteAttachment(
  ctx: McpContext,
  params: z.infer<typeof deleteAttachmentSchema>
) {
  // Fetch attachment to get storage_path and file_name
  const { data: attachment, error: fetchError } = await ctx.supabase
    .from("board_task_attachments")
    .select("storage_path, file_name")
    .eq("id", params.attachment_id)
    .eq("task_id", params.task_id)
    .maybeSingle();

  if (fetchError) throw new Error(`Failed to fetch attachment: ${fetchError.message}`);
  if (!attachment) throw new Error(`Attachment not found: ${params.attachment_id}`);

  // If this attachment is the task's cover image, clear it
  const { data: task } = await ctx.supabase
    .from("board_tasks")
    .select("cover_image_path")
    .eq("id", params.task_id)
    .single();

  if (task?.cover_image_path === attachment.storage_path) {
    await ctx.supabase
      .from("board_tasks")
      .update({ cover_image_path: null })
      .eq("id", params.task_id);
  }

  // Delete from storage
  const { error: storageError } = await ctx.supabase.storage
    .from("task-attachments")
    .remove([attachment.storage_path]);

  if (storageError) {
    logger.error("Failed to delete file from storage", { error: storageError.message, attachmentId: params.attachment_id });
  }

  // Delete DB row
  const { error: dbError } = await ctx.supabase
    .from("board_task_attachments")
    .delete()
    .eq("id", params.attachment_id);

  if (dbError) throw new Error(`Failed to delete attachment record: ${dbError.message}`);

  // Log activity
  await logActivity(ctx, params.task_id, params.idea_id, "attachment_removed", {
    file_name: attachment.file_name,
  });

  return { success: true };
}
