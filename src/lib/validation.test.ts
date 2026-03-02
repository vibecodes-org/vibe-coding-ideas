import { describe, it, expect } from "vitest";
import {
  validateTitle,
  validateDescription,
  validateOptionalDescription,
  validateComment,
  validateGithubUrl,
  validateTags,
  validateLabelColor,
  validateLabelName,
  validateBio,
  validateAvatarUrl,
  validateUuid,
  validateDiscussionTitle,
  validateDiscussionBody,
  validateDiscussionReply,
  ValidationError,
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_COMMENT_LENGTH,
  MAX_BIO_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS,
  MAX_LABEL_NAME_LENGTH,
  MAX_AVATAR_URL_LENGTH,
  MAX_DISCUSSION_BODY_LENGTH,
  MAX_DISCUSSION_REPLY_LENGTH,
} from "./validation";

describe("validateTitle", () => {
  it("returns trimmed title", () => {
    expect(validateTitle("  Hello World  ")).toBe("Hello World");
  });

  it("throws on empty title", () => {
    expect(() => validateTitle("")).toThrow(ValidationError);
    expect(() => validateTitle("   ")).toThrow(ValidationError);
  });

  it("throws on too-long title", () => {
    expect(() => validateTitle("a".repeat(MAX_TITLE_LENGTH + 1))).toThrow(
      ValidationError
    );
  });

  it("accepts max length title", () => {
    expect(validateTitle("a".repeat(MAX_TITLE_LENGTH))).toHaveLength(
      MAX_TITLE_LENGTH
    );
  });
});

describe("validateDescription", () => {
  it("returns trimmed description", () => {
    expect(validateDescription("  Hello  ")).toBe("Hello");
  });

  it("throws on empty description", () => {
    expect(() => validateDescription("")).toThrow(ValidationError);
  });

  it("throws on too-long description", () => {
    expect(() =>
      validateDescription("a".repeat(MAX_DESCRIPTION_LENGTH + 1))
    ).toThrow(ValidationError);
  });
});

describe("validateOptionalDescription", () => {
  it("returns null for empty string", () => {
    expect(validateOptionalDescription("")).toBeNull();
    expect(validateOptionalDescription(null)).toBeNull();
    expect(validateOptionalDescription("   ")).toBeNull();
  });

  it("returns trimmed value", () => {
    expect(validateOptionalDescription("  Hello  ")).toBe("Hello");
  });

  it("throws on too-long description", () => {
    expect(() =>
      validateOptionalDescription("a".repeat(MAX_DESCRIPTION_LENGTH + 1))
    ).toThrow(ValidationError);
  });
});

describe("validateComment", () => {
  it("returns trimmed comment", () => {
    expect(validateComment("  Hello  ")).toBe("Hello");
  });

  it("throws on empty comment", () => {
    expect(() => validateComment("")).toThrow(ValidationError);
  });

  it("throws on too-long comment", () => {
    expect(() => validateComment("a".repeat(MAX_COMMENT_LENGTH + 1))).toThrow(
      ValidationError
    );
  });
});

describe("validateGithubUrl", () => {
  it("returns null for empty/null", () => {
    expect(validateGithubUrl(null)).toBeNull();
    expect(validateGithubUrl("")).toBeNull();
    expect(validateGithubUrl("   ")).toBeNull();
  });

  it("accepts valid GitHub URLs", () => {
    expect(validateGithubUrl("https://github.com/user/repo")).toBe(
      "https://github.com/user/repo"
    );
  });

  it("rejects non-GitHub URLs", () => {
    expect(() => validateGithubUrl("https://gitlab.com/user/repo")).toThrow(
      ValidationError
    );
    expect(() => validateGithubUrl("not-a-url")).toThrow(ValidationError);
  });
});

describe("validateTags", () => {
  it("returns empty array for empty string", () => {
    expect(validateTags("")).toEqual([]);
  });

  it("splits and trims tags", () => {
    expect(validateTags("react, next.js, typescript")).toEqual([
      "react",
      "next.js",
      "typescript",
    ]);
  });

  it("throws on too many tags", () => {
    const tags = Array.from({ length: MAX_TAGS + 1 }, (_, i) => `tag${i}`).join(",");
    expect(() => validateTags(tags)).toThrow(ValidationError);
  });

  it("throws on too-long tag", () => {
    expect(() => validateTags("a".repeat(MAX_TAG_LENGTH + 1))).toThrow(
      ValidationError
    );
  });
});

describe("validateLabelColor", () => {
  it("accepts valid colors", () => {
    expect(validateLabelColor("blue")).toBe("blue");
    expect(validateLabelColor("red")).toBe("red");
  });

  it("rejects invalid colors", () => {
    expect(() => validateLabelColor("neon")).toThrow(ValidationError);
    expect(() => validateLabelColor("")).toThrow(ValidationError);
  });
});

describe("validateLabelName", () => {
  it("returns trimmed name", () => {
    expect(validateLabelName("  Bug  ")).toBe("Bug");
  });

  it("throws on empty name", () => {
    expect(() => validateLabelName("")).toThrow(ValidationError);
  });

  it("throws on too-long name", () => {
    expect(() =>
      validateLabelName("a".repeat(MAX_LABEL_NAME_LENGTH + 1))
    ).toThrow(ValidationError);
  });
});

describe("validateAvatarUrl", () => {
  it("returns null for null/empty", () => {
    expect(validateAvatarUrl(null)).toBeNull();
    expect(validateAvatarUrl("")).toBeNull();
    expect(validateAvatarUrl("   ")).toBeNull();
  });

  it("accepts valid URLs", () => {
    expect(validateAvatarUrl("https://example.com/avatar.png")).toBe(
      "https://example.com/avatar.png"
    );
    expect(validateAvatarUrl("  https://cdn.supabase.co/storage/v1/object/public/avatars/123/avatar  ")).toBe(
      "https://cdn.supabase.co/storage/v1/object/public/avatars/123/avatar"
    );
  });

  it("rejects non-URLs", () => {
    expect(() => validateAvatarUrl("not-a-url")).toThrow(ValidationError);
    expect(() => validateAvatarUrl("just some text")).toThrow(ValidationError);
  });

  it("rejects too-long URLs", () => {
    const longUrl = "https://example.com/" + "a".repeat(MAX_AVATAR_URL_LENGTH);
    expect(() => validateAvatarUrl(longUrl)).toThrow(ValidationError);
  });
});

describe("validateBio", () => {
  it("returns null for empty/null", () => {
    expect(validateBio(null)).toBeNull();
    expect(validateBio("")).toBeNull();
  });

  it("returns trimmed bio", () => {
    expect(validateBio("  Hello  ")).toBe("Hello");
  });

  it("throws on too-long bio", () => {
    expect(() => validateBio("a".repeat(MAX_BIO_LENGTH + 1))).toThrow(
      ValidationError
    );
  });
});

describe("validateUuid", () => {
  it("accepts valid UUIDs", () => {
    expect(validateUuid("a0000000-0000-4000-a000-000000000001")).toBe(
      "a0000000-0000-4000-a000-000000000001"
    );
    expect(validateUuid("  A0000000-0000-4000-A000-000000000001  ")).toBe(
      "A0000000-0000-4000-A000-000000000001"
    );
  });

  it("throws on empty value", () => {
    expect(() => validateUuid("")).toThrow(ValidationError);
    expect(() => validateUuid("   ")).toThrow(ValidationError);
  });

  it("throws on invalid UUID format", () => {
    expect(() => validateUuid("not-a-uuid")).toThrow(ValidationError);
    expect(() => validateUuid("12345")).toThrow(ValidationError);
    expect(() => validateUuid("a0000000-0000-4000-a000-00000000000g")).toThrow(
      ValidationError
    );
  });

  it("uses custom label in error message", () => {
    expect(() => validateUuid("bad", "Bot ID")).toThrow("Bot ID must be a valid UUID");
  });
});

describe("validateDiscussionTitle", () => {
  it("returns trimmed title", () => {
    expect(validateDiscussionTitle("  Phase 2 Planning  ")).toBe("Phase 2 Planning");
  });

  it("throws on empty title", () => {
    expect(() => validateDiscussionTitle("")).toThrow(ValidationError);
    expect(() => validateDiscussionTitle("   ")).toThrow(ValidationError);
  });

  it("throws on too-long title", () => {
    expect(() => validateDiscussionTitle("a".repeat(MAX_TITLE_LENGTH + 1))).toThrow(
      ValidationError
    );
  });
});

describe("validateDiscussionBody", () => {
  it("returns trimmed body", () => {
    expect(validateDiscussionBody("  Hello world  ")).toBe("Hello world");
  });

  it("throws on empty body", () => {
    expect(() => validateDiscussionBody("")).toThrow(ValidationError);
    expect(() => validateDiscussionBody("   ")).toThrow(ValidationError);
  });

  it("throws on too-long body", () => {
    expect(() => validateDiscussionBody("a".repeat(MAX_DISCUSSION_BODY_LENGTH + 1))).toThrow(
      ValidationError
    );
  });
});

describe("validateDiscussionReply", () => {
  it("returns trimmed content", () => {
    expect(validateDiscussionReply("  Great idea!  ")).toBe("Great idea!");
  });

  it("throws on empty reply", () => {
    expect(() => validateDiscussionReply("")).toThrow(ValidationError);
    expect(() => validateDiscussionReply("   ")).toThrow(ValidationError);
  });

  it("throws on too-long reply", () => {
    expect(() => validateDiscussionReply("a".repeat(MAX_DISCUSSION_REPLY_LENGTH + 1))).toThrow(
      ValidationError
    );
  });
});
