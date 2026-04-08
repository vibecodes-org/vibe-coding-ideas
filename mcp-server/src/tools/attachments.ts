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

// --- request_upload_url ---

export const requestUploadUrlSchema = z.object({
  task_id: z.string().uuid().describe("The task ID"),
  idea_id: z.string().uuid().describe("The idea ID"),
  file_name: z.string().min(1).max(255).describe("The file name including extension"),
  content_type: z.string().min(1).describe("MIME content type (e.g. image/png, application/pdf)"),
  file_size: z.number().int().positive().describe("File size in bytes"),
});

export async function requestUploadUrl(
  ctx: McpContext,
  params: z.infer<typeof requestUploadUrlSchema>
) {
  // Validate content type
  if (!ALLOWED_CONTENT_TYPES.includes(params.content_type)) {
    throw new Error(
      `Content type "${params.content_type}" not allowed. Allowed types: ${ALLOWED_CONTENT_TYPES.join(", ")}`
    );
  }

  // Validate file size
  if (params.file_size > MAX_FILE_SIZE) {
    throw new Error(
      `File size ${params.file_size} bytes exceeds maximum of ${MAX_FILE_SIZE} bytes (10MB)`
    );
  }

  // Generate storage path
  const lastDot = params.file_name.lastIndexOf(".");
  const ext = lastDot > 0 ? params.file_name.slice(lastDot + 1) : "bin";
  const storagePath = `${params.idea_id}/${params.task_id}/${randomUUID()}.${ext}`;

  // Create presigned upload URL
  const { data: signedData, error: signError } = await ctx.supabase.storage
    .from("task-attachments")
    .createSignedUploadUrl(storagePath);

  if (signError || !signedData) {
    throw new Error(`Failed to create upload URL: ${signError?.message ?? "unknown error"}`);
  }

  // Store pending upload record (expires in 10 minutes)
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const userId = ctx.ownerUserId ?? ctx.userId;

  const { error: insertError } = await ctx.supabase
    .from("pending_uploads")
    .insert({
      token,
      storage_path: storagePath,
      file_name: params.file_name,
      content_type: params.content_type,
      file_size: params.file_size,
      user_id: userId,
      idea_id: params.idea_id,
      task_id: params.task_id,
      expires_at: expiresAt,
    });

  if (insertError) {
    throw new Error(`Failed to create pending upload: ${insertError.message}`);
  }

  // Clean up any expired pending uploads (fire and forget)
  ctx.supabase
    .from("pending_uploads")
    .delete()
    .lt("expires_at", new Date().toISOString())
    .then(() => {});

  // Build a ready-to-use curl command
  const curlCommand = `curl -X PUT -H "Content-Type: ${params.content_type}" -T "<LOCAL_FILE_PATH>" "${signedData.signedUrl}"`;

  return {
    signed_url: signedData.signedUrl,
    upload_token: token,
    storage_path: storagePath,
    expires_in_seconds: 600,
    curl_command: curlCommand,
    instructions: "Upload the file using the curl command above (replace <LOCAL_FILE_PATH> with the actual file path), then call confirm_upload with the upload_token.",
  };
}

// --- confirm_upload ---

export const confirmUploadSchema = z.object({
  upload_token: z.string().uuid().describe("The upload token from request_upload_url"),
  task_id: z.string().uuid().describe("The task ID"),
  idea_id: z.string().uuid().describe("The idea ID"),
});

export async function confirmUpload(
  ctx: McpContext,
  params: z.infer<typeof confirmUploadSchema>
) {
  // Look up pending upload by token
  const { data: pending, error: fetchError } = await ctx.supabase
    .from("pending_uploads")
    .select("*")
    .eq("token", params.upload_token)
    .eq("task_id", params.task_id)
    .eq("idea_id", params.idea_id)
    .maybeSingle();

  if (fetchError) throw new Error(`Failed to look up upload token: ${fetchError.message}`);
  if (!pending) throw new Error("Upload token not found or does not match the task/idea");

  // Check expiry
  if (new Date(pending.expires_at) < new Date()) {
    // Clean up expired record
    await ctx.supabase.from("pending_uploads").delete().eq("id", pending.id);
    throw new Error("Upload token has expired. Request a new upload URL.");
  }

  // Verify file exists in storage (fast: create a short-lived signed URL — fails if file doesn't exist)
  const { error: verifyError } = await ctx.supabase.storage
    .from("task-attachments")
    .createSignedUrl(pending.storage_path, 10);

  if (verifyError) {
    throw new Error(
      "File not found in storage. Make sure you uploaded the file using the signed URL before calling confirm_upload."
    );
  }

  // Create DB record
  const { data: attachment, error: dbError } = await ctx.supabase
    .from("board_task_attachments")
    .insert({
      task_id: params.task_id,
      idea_id: params.idea_id,
      uploaded_by: ctx.userId,
      file_name: pending.file_name,
      file_size: pending.file_size,
      content_type: pending.content_type,
      storage_path: pending.storage_path,
    })
    .select("id, file_name, storage_path")
    .single();

  if (dbError) throw new Error(`Failed to save attachment record: ${dbError.message}`);

  // Auto-set cover image if first image upload
  if (pending.content_type.startsWith("image/")) {
    const { data: task } = await ctx.supabase
      .from("board_tasks")
      .select("cover_image_path")
      .eq("id", params.task_id)
      .single();

    if (!task?.cover_image_path) {
      await ctx.supabase
        .from("board_tasks")
        .update({ cover_image_path: pending.storage_path })
        .eq("id", params.task_id);
    }
  }

  // Log activity + generate signed URL + clean up pending record
  const [, , urlResult] = await Promise.all([
    logActivity(ctx, params.task_id, params.idea_id, "attachment_added", {
      file_name: pending.file_name,
    }),
    ctx.supabase.from("pending_uploads").delete().eq("id", pending.id),
    ctx.supabase.storage
      .from("task-attachments")
      .createSignedUrl(pending.storage_path, 3600),
  ]);

  return {
    success: true,
    attachment: {
      id: attachment.id,
      file_name: attachment.file_name,
      file_size: pending.file_size,
      storage_path: attachment.storage_path,
      url: urlResult.data?.signedUrl ?? null,
    },
  };
}

// --- download_attachment ---

const TEXT_CONTENT_TYPES = [
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/html",
  "application/json",
];

export const downloadAttachmentSchema = z.object({
  attachment_id: z.string().uuid().describe("The attachment ID"),
  task_id: z.string().uuid().describe("The task ID"),
  idea_id: z.string().uuid().describe("The idea ID"),
});

export async function downloadAttachment(
  ctx: McpContext,
  params: z.infer<typeof downloadAttachmentSchema>
) {
  // Look up attachment
  const { data: attachment, error } = await ctx.supabase
    .from("board_task_attachments")
    .select("id, file_name, file_size, content_type, storage_path")
    .eq("id", params.attachment_id)
    .eq("task_id", params.task_id)
    .eq("idea_id", params.idea_id)
    .maybeSingle();

  if (error) throw new Error(`Failed to fetch attachment: ${error.message}`);
  if (!attachment) throw new Error(`Attachment not found: ${params.attachment_id}`);

  // Generate signed URL
  const { data: urlData, error: urlError } = await ctx.supabase.storage
    .from("task-attachments")
    .createSignedUrl(attachment.storage_path, 3600);

  if (urlError || !urlData?.signedUrl) {
    throw new Error(`Failed to generate download URL: ${urlError?.message ?? "unknown error"}`);
  }

  const isText = TEXT_CONTENT_TYPES.includes(attachment.content_type);

  if (isText) {
    // Fetch and return text content inline
    const response = await fetch(urlData.signedUrl);
    if (!response.ok) {
      throw new Error(`Failed to download file: HTTP ${response.status}`);
    }
    const content = await response.text();

    return {
      id: attachment.id,
      file_name: attachment.file_name,
      content_type: attachment.content_type,
      file_size: attachment.file_size,
      content,
    };
  }

  // Binary file — return signed URL only
  return {
    id: attachment.id,
    file_name: attachment.file_name,
    content_type: attachment.content_type,
    file_size: attachment.file_size,
    url: urlData.signedUrl,
    hint: `This is a binary file (${attachment.content_type}). Use the URL to download it — Claude Code can read images and PDFs directly via the Read tool after downloading.`,
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
