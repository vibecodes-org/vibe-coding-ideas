-- Add 'step_compliance' to the notification_type enum (docs/design-compliance-alerts.html §3)
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'step_compliance';
