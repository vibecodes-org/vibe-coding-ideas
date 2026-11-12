import { describe, it, expect } from "vitest";
import { pickAutoRuleTemplate } from "./auto-rule-pick";

const rules = [
  { label_id: "bug", template_id: "t-bug" },
  { label_id: "feat", template_id: "t-feat" },
  { label_id: "fix", template_id: "t-bug" },
];

describe("pickAutoRuleTemplate", () => {
  it("returns none for no labels", () => {
    expect(pickAutoRuleTemplate([], rules)).toEqual({
      templateId: null,
      sourceLabelId: null,
      otherMatchedLabelIds: [],
    });
  });
  it("returns none for an empty rules list", () => {
    expect(pickAutoRuleTemplate(["bug"], []).templateId).toBeNull();
  });
  it("ignores labels without a rule", () => {
    expect(pickAutoRuleTemplate(["x"], rules).templateId).toBeNull();
  });
  it("picks the single match", () => {
    expect(pickAutoRuleTemplate(["x", "bug"], rules)).toEqual({
      templateId: "t-bug",
      sourceLabelId: "bug",
      otherMatchedLabelIds: [],
    });
  });
  it("first ticked wins when templates differ", () => {
    const a = pickAutoRuleTemplate(["bug", "feat"], rules);
    expect(a.templateId).toBe("t-bug");
    expect(a.otherMatchedLabelIds).toEqual(["feat"]);
    const b = pickAutoRuleTemplate(["feat", "bug"], rules);
    expect(b.templateId).toBe("t-feat");
    expect(b.sourceLabelId).toBe("feat");
    expect(b.otherMatchedLabelIds).toEqual(["bug"]);
  });
  it("does not list labels that point at the same template", () => {
    const r = pickAutoRuleTemplate(["bug", "fix"], rules);
    expect(r.templateId).toBe("t-bug");
    expect(r.otherMatchedLabelIds).toEqual([]);
  });
});
