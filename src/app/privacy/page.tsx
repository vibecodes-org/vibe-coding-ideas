import Link from "next/link";
import { Shield, ArrowLeft } from "lucide-react";

const LAST_UPDATED = "24 February 2026";

export default function PrivacyPolicyPage() {
  return (
    <>
      <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Home
        </Link>

        <div className="mb-10 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Privacy Policy
            </h1>
            <p className="text-sm text-muted-foreground">
              Last updated: {LAST_UPDATED}
            </p>
          </div>
        </div>

        <div className="space-y-10">
          {/* Introduction & Controller Identity */}
          <section>
            <p className="mb-4 text-muted-foreground">
              VibeCodes (<strong className="text-foreground">vibecodes.co.uk</strong>) is
              an AI-powered idea board for developers. This policy explains what
              data we collect, why we collect it, how we store it, and what
              rights you have over it. We&apos;ve written this in plain English
              &mdash; no legal jargon.
            </p>
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <h3 className="mb-2 text-sm font-semibold">Data Controller</h3>
              <p className="text-sm text-muted-foreground">
                VibeCodes is operated by{" "}
                <strong className="text-foreground">Nicholas Ball</strong> (sole trader).
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Contact:{" "}
                <a
                  href="mailto:info@vibecodes.co.uk"
                  className="text-primary hover:underline"
                >
                  info@vibecodes.co.uk
                </a>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Address: United Kingdom (full address available on written request)
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                No Data Protection Officer has been appointed as VibeCodes
                operates at a scale that does not require one under UK GDPR
                Article 37.
              </p>
            </div>
          </section>

          {/* Data We Collect */}
          <section>
            <h2 className="mb-4 text-2xl font-semibold">Data We Collect</h2>
            <p className="mb-4 text-muted-foreground">
              We only collect data that is necessary for VibeCodes to function.
              Here&apos;s everything we store:
            </p>

            <div className="space-y-6">
              <div>
                <h3 className="mb-2 text-lg font-medium">Account Information</h3>
                <p className="text-muted-foreground">
                  When you sign up, we store your{" "}
                  <strong className="text-foreground">email address</strong>,{" "}
                  <strong className="text-foreground">display name</strong>, and{" "}
                  <strong className="text-foreground">avatar</strong> (either
                  from your OAuth provider or uploaded manually). You may
                  optionally provide a{" "}
                  <strong className="text-foreground">bio</strong>,{" "}
                  <strong className="text-foreground">GitHub username</strong>,
                  and{" "}
                  <strong className="text-foreground">contact information</strong>{" "}
                  (e.g. Discord, Twitter). If you sign up via GitHub or Google,
                  we receive your public profile information from those services.
                </p>
              </div>

              <div>
                <h3 className="mb-2 text-lg font-medium">
                  Ideas &amp; Content
                </h3>
                <p className="text-muted-foreground">
                  Everything you create on VibeCodes &mdash; ideas (titles,
                  descriptions, tags, linked GitHub repository URLs), comments,
                  votes, and collaborator relationships. Ideas can be set to{" "}
                  <strong className="text-foreground">public</strong> (visible to
                  everyone) or{" "}
                  <strong className="text-foreground">private</strong> (visible
                  only to you, your collaborators, and admins).
                </p>
              </div>

              <div>
                <h3 className="mb-2 text-lg font-medium">
                  Board &amp; Task Data
                </h3>
                <p className="text-muted-foreground">
                  Kanban board columns, tasks, labels, workflow steps, due dates,
                  task comments, activity logs, and file attachments (up to 10MB
                  per file). Profile pictures are stored in a{" "}
                  <strong className="text-foreground">publicly accessible</strong>{" "}
                  storage bucket. Task file attachments are stored in a{" "}
                  <strong className="text-foreground">private</strong> bucket
                  with time-limited signed download URLs.
                </p>
              </div>

              <div>
                <h3 className="mb-2 text-lg font-medium">AI Interaction Data</h3>
                <p className="text-muted-foreground">
                  When you use AI features (idea enhancement, task generation),
                  we send your prompts and relevant idea/task content to
                  Anthropic&apos;s Claude API. We log the{" "}
                  <strong className="text-foreground">token counts</strong>,{" "}
                  <strong className="text-foreground">model used</strong>, and{" "}
                  <strong className="text-foreground">action type</strong> for
                  rate limiting and analytics. We do not store the full AI
                  responses separately. If you provide your own Anthropic API key
                  (BYOK), it is encrypted using AES-256-GCM before storage and
                  only decrypted server-side when processing your AI requests.
                  BYOK users are exempt from platform rate limits. If you save
                  custom AI prompt templates, we store the template name and
                  prompt text linked to your account.
                </p>
              </div>

              <div>
                <h3 className="mb-2 text-lg font-medium">Agent Profiles</h3>
                <p className="text-muted-foreground">
                  If you create AI agent personas, we store the agent name, role,
                  system prompt, and avatar URL. These are linked to your
                  account.
                </p>
              </div>

              <div>
                <h3 className="mb-2 text-lg font-medium">Feedback</h3>
                <p className="text-muted-foreground">
                  If you submit feedback (bug reports, suggestions, questions) via
                  the in-app feedback dialog, we store the feedback content,
                  category, and the page URL you submitted it from.
                </p>
              </div>

              <div>
                <h3 className="mb-2 text-lg font-medium">
                  Notification Preferences
                </h3>
                <p className="text-muted-foreground">
                  Your per-type notification settings (votes, comments,
                  collaborator joins, status changes, task mentions) are stored
                  so we only send you notifications you want.
                </p>
              </div>

              <div>
                <h3 className="mb-2 text-lg font-medium">
                  Cookies &amp; Client-Side Storage
                </h3>
                <p className="text-muted-foreground">
                  We set{" "}
                  <strong className="text-foreground">essential authentication cookies</strong>{" "}
                  (Supabase session tokens) to keep you logged in. These are
                  strictly necessary for the service to function and do not track
                  you across websites. We also use{" "}
                  <strong className="text-foreground">localStorage</strong> in
                  your browser for dashboard layout preferences, collapsed
                  section states, and theme preference (light/dark). Our{" "}
                  <strong className="text-foreground">service worker</strong>{" "}
                  caches static assets locally on your device to improve
                  performance; this data stays on your device and is cleared when
                  you uninstall the app or clear browser storage. We do not use
                  third-party tracking cookies or analytics cookies.
                </p>
              </div>

              <div>
                <h3 className="mb-2 text-lg font-medium">
                  API Access (MCP)
                </h3>
                <p className="text-muted-foreground">
                  VibeCodes exposes a remote API (Model Context Protocol) that
                  allows authorised third-party tools (such as Claude Code) to
                  read and write your data on your behalf. Access requires your
                  explicit authorisation via OAuth 2.1 with PKCE. When you
                  authorise a client, we store the OAuth client registration and
                  temporary authorisation codes. You can revoke access at any
                  time by removing the MCP connection in your client application.
                </p>
              </div>
            </div>
          </section>

          {/* Legal Basis for Processing */}
          <section>
            <h2 className="mb-4 text-2xl font-semibold">
              Legal Basis for Processing
            </h2>
            <p className="mb-4 text-muted-foreground">
              Under UK GDPR Article 6, we process your data on the following
              lawful bases:
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="pb-3 pr-4 text-left font-semibold">
                      Processing Activity
                    </th>
                    <th className="pb-3 text-left font-semibold">
                      Legal Basis
                    </th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  <tr className="border-b border-border/50">
                    <td className="py-3 pr-4">Account creation, authentication, profile</td>
                    <td className="py-3">
                      <strong className="text-foreground">Contract</strong> (Art 6(1)(b)) &mdash; necessary to provide the service
                    </td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-3 pr-4">Ideas, boards, tasks, comments, votes, collaborations</td>
                    <td className="py-3">
                      <strong className="text-foreground">Contract</strong> (Art 6(1)(b)) &mdash; core service functionality
                    </td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-3 pr-4">AI features (idea enhancement, task generation)</td>
                    <td className="py-3">
                      <strong className="text-foreground">Consent</strong> (Art 6(1)(a)) &mdash; you explicitly initiate each AI request
                    </td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-3 pr-4">BYOK API key storage (encrypted)</td>
                    <td className="py-3">
                      <strong className="text-foreground">Consent</strong> (Art 6(1)(a)) &mdash; you choose to provide your own key
                    </td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-3 pr-4">In-app notifications</td>
                    <td className="py-3">
                      <strong className="text-foreground">Contract</strong> (Art 6(1)(b)) &mdash; part of the service, controlled by your preferences
                    </td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-3 pr-4">Rate limiting, abuse prevention, AI usage logging</td>
                    <td className="py-3">
                      <strong className="text-foreground">Legitimate interest</strong> (Art 6(1)(f)) &mdash; protecting the service and other users
                    </td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-3 pr-4">Aggregate landing page statistics</td>
                    <td className="py-3">
                      <strong className="text-foreground">Legitimate interest</strong> (Art 6(1)(f)) &mdash; anonymous counts only
                    </td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-3 pr-4">MCP API access (third-party tool authorisation)</td>
                    <td className="py-3">
                      <strong className="text-foreground">Consent</strong> (Art 6(1)(a)) &mdash; you explicitly authorise each client
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4">Feedback submissions</td>
                    <td className="py-3">
                      <strong className="text-foreground">Consent</strong> (Art 6(1)(a)) &mdash; you choose to submit feedback
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Third-Party Services */}
          <section>
            <h2 className="mb-4 text-2xl font-semibold">
              Third-Party Services
            </h2>
            <p className="mb-4 text-muted-foreground">
              VibeCodes relies on the following third-party services:
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="pb-3 pr-4 text-left font-semibold">
                      Service
                    </th>
                    <th className="pb-3 pr-4 text-left font-semibold">
                      Purpose
                    </th>
                    <th className="pb-3 text-left font-semibold">
                      Data Shared
                    </th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  <tr className="border-b border-border/50">
                    <td className="py-3 pr-4 font-medium text-foreground">
                      Supabase
                    </td>
                    <td className="py-3 pr-4">
                      Authentication, database, file storage, realtime updates
                    </td>
                    <td className="py-3">All user data</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-3 pr-4 font-medium text-foreground">
                      Vercel
                    </td>
                    <td className="py-3 pr-4">Hosting and edge functions</td>
                    <td className="py-3">Request logs, IP addresses</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-3 pr-4 font-medium text-foreground">
                      GitHub OAuth
                    </td>
                    <td className="py-3 pr-4">Authentication</td>
                    <td className="py-3">
                      Profile info (email, name, avatar)
                    </td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-3 pr-4 font-medium text-foreground">
                      Google OAuth
                    </td>
                    <td className="py-3 pr-4">Authentication</td>
                    <td className="py-3">
                      Profile info (email, name, avatar)
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-medium text-foreground">
                      Anthropic (Claude)
                    </td>
                    <td className="py-3 pr-4">AI features</td>
                    <td className="py-3">
                      Idea descriptions, prompts (only when you use AI features)
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="mt-4 text-sm text-muted-foreground">
              We do not sell your data to any third party. Data shared with
              these services is limited to what&apos;s necessary for their
              function.
            </p>
          </section>

          {/* International Data Transfers */}
          <section>
            <h2 className="mb-4 text-2xl font-semibold">
              International Data Transfers
            </h2>
            <p className="mb-4 text-muted-foreground">
              Your data is transferred to and processed in the{" "}
              <strong className="text-foreground">United States</strong> by the
              following providers:
            </p>
            <ul className="list-inside list-disc space-y-2 text-muted-foreground">
              <li>
                <strong className="text-foreground">Supabase</strong> (AWS US) &mdash; database, authentication, file storage
              </li>
              <li>
                <strong className="text-foreground">Vercel</strong> (US, global edge network) &mdash; hosting, serverless functions
              </li>
              <li>
                <strong className="text-foreground">Anthropic</strong> (US) &mdash; AI processing (only when you use AI features)
              </li>
              <li>
                <strong className="text-foreground">GitHub / Google</strong> (US) &mdash; OAuth authentication
              </li>
            </ul>
            <p className="mt-4 text-muted-foreground">
              These transfers are protected by the{" "}
              <strong className="text-foreground">UK-US Data Bridge</strong>{" "}
              (where applicable) and{" "}
              <strong className="text-foreground">Standard Contractual Clauses (SCCs)</strong>{" "}
              incorporated into our agreements with these providers.
            </p>
          </section>

          {/* How We Use Your Data */}
          <section>
            <h2 className="mb-4 text-2xl font-semibold">
              How We Use Your Data
            </h2>
            <ul className="list-inside list-disc space-y-2 text-muted-foreground">
              <li>To provide and maintain VibeCodes functionality</li>
              <li>To authenticate you and protect your account</li>
              <li>To send you in-app notifications based on your preferences</li>
              <li>
                To process AI requests (idea enhancement, task generation) when
                you initiate them
              </li>
              <li>
                To enforce rate limits and prevent abuse of AI features
              </li>
              <li>To display your public profile to other users</li>
              <li>
                To generate anonymous, aggregate usage statistics (total idea
                count, user count, and collaboration count displayed on the
                landing page)
              </li>
              <li>
                To process feedback you submit and improve the service
              </li>
            </ul>
          </section>

          {/* Providing Data */}
          <section>
            <h2 className="mb-4 text-2xl font-semibold">
              Is Providing Your Data Required?
            </h2>
            <p className="text-muted-foreground">
              Providing your{" "}
              <strong className="text-foreground">email address</strong> and{" "}
              <strong className="text-foreground">display name</strong> is
              necessary to create an account and use VibeCodes. This is a
              contractual requirement &mdash; without it, we cannot provide the
              service. All other data (bio, GitHub username, contact info, file
              uploads, AI features, feedback) is optional. If you do not provide
              optional data, some features may be limited but your core account
              will function normally.
            </p>
          </section>

          {/* Automated Decision-Making */}
          <section>
            <h2 className="mb-4 text-2xl font-semibold">
              Automated Decision-Making
            </h2>
            <p className="text-muted-foreground">
              VibeCodes uses automated processing in two areas:{" "}
              <strong className="text-foreground">AI rate limiting</strong>{" "}
              (counting your daily AI usage to enforce per-user caps) and{" "}
              <strong className="text-foreground">AI content generation</strong>{" "}
              (enhancing idea descriptions and generating board tasks using
              Anthropic&apos;s Claude). These do not produce legal effects or
              similarly significant decisions about you. AI-generated content is
              always presented for your review before being applied &mdash;
              nothing is changed without your explicit confirmation.
            </p>
          </section>

          {/* Data Retention & Deletion */}
          <section>
            <h2 className="mb-4 text-2xl font-semibold">
              Data Retention &amp; Deletion
            </h2>
            <p className="mb-4 text-muted-foreground">
              Your data is retained for as long as your account is active.
              Specific retention periods:
            </p>
            <ul className="mb-4 list-inside list-disc space-y-2 text-muted-foreground">
              <li>
                <strong className="text-foreground">Account data, ideas, boards, tasks</strong>{" "}
                &mdash; retained until you delete your account
              </li>
              <li>
                <strong className="text-foreground">AI usage logs and activity logs</strong>{" "}
                &mdash; retained for the lifetime of your account (used for rate
                limiting and audit)
              </li>
              <li>
                <strong className="text-foreground">Feedback submissions</strong>{" "}
                &mdash; retained until account deletion
              </li>
              <li>
                <strong className="text-foreground">OAuth authorisation codes</strong>{" "}
                &mdash; expire and are deleted after 10 minutes
              </li>
              <li>
                <strong className="text-foreground">Server access logs</strong>{" "}
                &mdash; retained by Vercel per{" "}
                <a
                  href="https://vercel.com/docs/privacy-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Vercel&apos;s retention policy
                </a>
              </li>
            </ul>
            <p className="text-muted-foreground">
              When your account is deleted, a{" "}
              <strong className="text-foreground">cascade delete</strong>{" "}
              removes all associated data: your profile, ideas, comments, votes,
              collaborator relationships, board tasks, file attachments, AI usage
              logs, prompt templates, feedback, agent profiles, and
              notifications. This is permanent and cannot be undone.
            </p>
          </section>

          {/* Your Rights */}
          <section>
            <h2 className="mb-4 text-2xl font-semibold">Your Rights</h2>
            <p className="mb-4 text-muted-foreground">
              Under UK GDPR, you have the right to:
            </p>
            <ul className="list-inside list-disc space-y-2 text-muted-foreground">
              <li>
                <strong className="text-foreground">Access</strong> &mdash;
                request a copy of the data we hold about you
              </li>
              <li>
                <strong className="text-foreground">Rectification</strong> &mdash;
                update your profile, ideas, and comments at any time through the
                app, or request corrections by contacting us
              </li>
              <li>
                <strong className="text-foreground">Erasure</strong> &mdash;
                request account deletion by contacting us (admin users can also
                delete accounts directly). All data is cascade-deleted.
              </li>
              <li>
                <strong className="text-foreground">Restriction of processing</strong>{" "}
                &mdash; request that we limit how we process your data in certain
                circumstances (e.g. while we verify its accuracy)
              </li>
              <li>
                <strong className="text-foreground">Data portability</strong>{" "}
                &mdash; request an export of your data in a machine-readable
                format
              </li>
              <li>
                <strong className="text-foreground">Object</strong> &mdash;
                object to processing based on legitimate interest (rate limiting,
                aggregate statistics). We will stop unless we have compelling
                grounds that override your rights.
              </li>
              <li>
                <strong className="text-foreground">Withdraw consent</strong>{" "}
                &mdash; you can stop using AI features at any time, revoke MCP
                API access by removing the connection in your client app, and
                revoke OAuth access from your GitHub/Google account settings.
                Withdrawing consent does not affect the lawfulness of processing
                carried out before withdrawal.
              </li>
            </ul>
            <p className="mt-4 text-muted-foreground">
              To exercise any of these rights, contact us at{" "}
              <a
                href="mailto:privacy@vibecodes.co.uk"
                className="text-primary hover:underline"
              >
                privacy@vibecodes.co.uk
              </a>
              . We aim to respond within 30 days.
            </p>
            <p className="mt-4 text-muted-foreground">
              If you are not satisfied with our response, you have the right to
              lodge a complaint with the{" "}
              <strong className="text-foreground">
                Information Commissioner&apos;s Office (ICO)
              </strong>{" "}
              at{" "}
              <a
                href="https://ico.org.uk"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                ico.org.uk
              </a>
              .
            </p>
          </section>

          {/* Security */}
          <section>
            <h2 className="mb-4 text-2xl font-semibold">Security</h2>
            <p className="text-muted-foreground">
              All data is transmitted over HTTPS. Database access is controlled
              by Row-Level Security (RLS) policies &mdash; users can only access
              their own data and public content. Task file attachments are stored
              in a private bucket with time-limited signed download URLs. Profile
              pictures are stored in a publicly accessible bucket. BYOK API keys
              are encrypted at rest using AES-256-GCM and only decrypted
              transiently on the server when processing your requests.
              Authentication uses industry-standard OAuth 2.0 and session
              management via Supabase Auth.
            </p>
          </section>

          {/* Data Breach Notification */}
          <section>
            <h2 className="mb-4 text-2xl font-semibold">
              Data Breach Notification
            </h2>
            <p className="text-muted-foreground">
              In the event of a personal data breach that poses a high risk to
              your rights and freedoms, we will notify affected users via email
              and in-app notification without undue delay, and report to the ICO
              within 72 hours as required by UK GDPR Article 33.
            </p>
          </section>

          {/* Children */}
          <section>
            <h2 className="mb-4 text-2xl font-semibold">Children</h2>
            <p className="text-muted-foreground">
              VibeCodes is not intended for users under 13 years of age. We do
              not knowingly collect data from children. Users between 13 and 18
              should have parental or guardian consent before using VibeCodes. If
              you believe a child has created an account without appropriate
              consent, please contact us and we will delete it.
            </p>
          </section>

          {/* Changes to This Policy */}
          <section>
            <h2 className="mb-4 text-2xl font-semibold">
              Changes to This Policy
            </h2>
            <p className="text-muted-foreground">
              We may update this policy from time to time. Changes will be
              posted on this page with an updated &ldquo;Last updated&rdquo;
              date. For significant changes, we&apos;ll notify users via in-app
              notification.
            </p>
          </section>

          {/* Contact */}
          <section>
            <h2 className="mb-4 text-2xl font-semibold">Contact</h2>
            <p className="text-muted-foreground">
              For privacy-related questions or to exercise your data rights,
              contact us at:{" "}
              <a
                href="mailto:privacy@vibecodes.co.uk"
                className="text-primary hover:underline"
              >
                privacy@vibecodes.co.uk
              </a>
            </p>
          </section>
        </div>
    </>
  );
}
