// Server-side input validation for server actions

export const MAX_TITLE_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 50000;
export const MAX_COMMENT_LENGTH = 5000;
export const MAX_BIO_LENGTH = 500;
export const MAX_TAG_LENGTH = 50;
export const MAX_TAGS = 10;
export const MAX_LABEL_NAME_LENGTH = 50;
export const MAX_IDEA_ATTACHMENTS = 10;
export const MAX_IDEA_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10 MB
export const ALLOWED_IDEA_ATTACHMENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "text/markdown",
] as const;

const VALID_LABEL_COLORS = [
  "red", "orange", "amber", "yellow", "lime", "green",
  "emerald", "blue", "cyan", "violet", "purple", "pink",
  "rose", "zinc",
];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const GITHUB_URL_PATTERN = /^https:\/\/github\.com\/.+/;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export function validateTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) throw new ValidationError("Title is required");
  if (trimmed.length > MAX_TITLE_LENGTH) {
    throw new ValidationError(`Title must be ${MAX_TITLE_LENGTH} characters or less`);
  }
  return trimmed;
}

export function validateDescription(description: string): string {
  const trimmed = description.trim();
  if (!trimmed) throw new ValidationError("Description is required");
  if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
    throw new ValidationError(`Description must be ${MAX_DESCRIPTION_LENGTH} characters or less`);
  }
  return trimmed;
}

export function validateOptionalDescription(description: string | null): string | null {
  if (!description) return null;
  const trimmed = description.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
    throw new ValidationError(`Description must be ${MAX_DESCRIPTION_LENGTH} characters or less`);
  }
  return trimmed;
}

export function validateComment(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) throw new ValidationError("Comment cannot be empty");
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new ValidationError(`Comment must be ${MAX_COMMENT_LENGTH} characters or less`);
  }
  return trimmed;
}

export function validateGithubUrl(url: string | null): string | null {
  if (!url || !url.trim()) return null;
  const trimmed = url.trim();
  if (!GITHUB_URL_PATTERN.test(trimmed)) {
    throw new ValidationError("GitHub URL must start with https://github.com/");
  }
  return trimmed;
}

export function validateTags(tagsRaw: string): string[] {
  if (!tagsRaw) return [];
  const tags = tagsRaw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (tags.length > MAX_TAGS) {
    throw new ValidationError(`Maximum ${MAX_TAGS} tags allowed`);
  }
  for (const tag of tags) {
    if (tag.length > MAX_TAG_LENGTH) {
      throw new ValidationError(`Tag "${tag}" exceeds ${MAX_TAG_LENGTH} characters`);
    }
  }
  return tags;
}

export function validateLabelColor(color: string): string {
  if (!VALID_LABEL_COLORS.includes(color)) {
    throw new ValidationError(`Invalid label color: ${color}`);
  }
  return color;
}

export function validateLabelName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new ValidationError("Label name is required");
  if (trimmed.length > MAX_LABEL_NAME_LENGTH) {
    throw new ValidationError(`Label name must be ${MAX_LABEL_NAME_LENGTH} characters or less`);
  }
  return trimmed;
}

export const MAX_DISCUSSION_BODY_LENGTH = 10000;
export const MAX_DISCUSSION_REPLY_LENGTH = 5000;

export function validateDiscussionTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) throw new ValidationError("Discussion title is required");
  if (trimmed.length > MAX_TITLE_LENGTH) {
    throw new ValidationError(`Discussion title must be ${MAX_TITLE_LENGTH} characters or less`);
  }
  return trimmed;
}

export function validateDiscussionBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) throw new ValidationError("Discussion body is required");
  if (trimmed.length > MAX_DISCUSSION_BODY_LENGTH) {
    throw new ValidationError(`Discussion body must be ${MAX_DISCUSSION_BODY_LENGTH} characters or less`);
  }
  return trimmed;
}

export function validateDiscussionReply(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) throw new ValidationError("Reply cannot be empty");
  if (trimmed.length > MAX_DISCUSSION_REPLY_LENGTH) {
    throw new ValidationError(`Reply must be ${MAX_DISCUSSION_REPLY_LENGTH} characters or less`);
  }
  return trimmed;
}

export const MAX_AVATAR_URL_LENGTH = 2000;

export function validateAvatarUrl(url: string | null): string | null {
  if (!url || !url.trim()) return null;
  const trimmed = url.trim();
  if (trimmed.length > MAX_AVATAR_URL_LENGTH) {
    throw new ValidationError("Avatar URL is too long");
  }
  try {
    new URL(trimmed);
  } catch {
    throw new ValidationError("Invalid avatar URL");
  }
  return trimmed;
}

export function validateUuid(value: string, label = "ID"): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ValidationError(`${label} is required`);
  if (!UUID_PATTERN.test(trimmed)) {
    throw new ValidationError(`${label} must be a valid UUID`);
  }
  return trimmed;
}

export function validateBio(bio: string | null): string | null {
  if (!bio) return null;
  const trimmed = bio.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_BIO_LENGTH) {
    throw new ValidationError(`Bio must be ${MAX_BIO_LENGTH} characters or less`);
  }
  return trimmed;
}
