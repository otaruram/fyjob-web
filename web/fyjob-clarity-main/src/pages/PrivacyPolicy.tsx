import { Link } from "react-router-dom";
import { FyjobLogo } from "@/components/FyjobLogo";

const PrivacyPolicy = () => {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background/95 backdrop-blur">
        <div className="container mx-auto flex h-16 items-center justify-between px-4 sm:px-6">
          <Link to="/" aria-label="FYJOB home">
            <FyjobLogo />
          </Link>
          <Link
            to="/"
            className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Back to Home
          </Link>
        </div>
      </header>

      <main className="container mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="space-y-8">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Privacy Policy</p>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">FYJOB Privacy Policy</h1>
            <p className="text-sm text-muted-foreground sm:text-base">Last updated: April 12, 2026</p>
            <p className="max-w-3xl text-sm leading-7 text-muted-foreground sm:text-base">
              This Privacy Policy explains how FYJOB and the FYJOB Scanner browser extension collect, use,
              and protect data when users access FYJOB services, the dashboard, and supported browser features.
            </p>
          </div>

          <section className="space-y-3 rounded-2xl border border-border bg-card/70 p-6">
            <h2 className="text-xl font-semibold">1. What We Collect</h2>
            <div className="space-y-3 text-sm leading-7 text-muted-foreground">
              <p>We may collect the following categories of data:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Account information such as email address and authentication session state</li>
                <li>CV data and uploaded files that users submit inside FYJOB</li>
                <li>Job posting content from the active page when the user explicitly triggers analysis</li>
                <li>Analysis history, interview sessions, quiz activity, and learning-path activity</li>
                <li>Technical data such as browser type, request metadata, and service logs for security and reliability</li>
              </ul>
            </div>
          </section>

          <section className="space-y-3 rounded-2xl border border-border bg-card/70 p-6">
            <h2 className="text-xl font-semibold">2. How the Browser Extension Works</h2>
            <div className="space-y-3 text-sm leading-7 text-muted-foreground">
              <p>
                The FYJOB Scanner extension reads visible job-post content from the current page only when needed to
                support job analysis features. It may also sync login state with the FYJOB dashboard so protected
                features stay locked until the user is authenticated.
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Page title, company name, job description, and page URL</li>
                <li>FYJOB dashboard session data stored by the user’s active FYJOB session</li>
                <li>Local browser storage used for temporary extension state and settings</li>
              </ul>
              <p>
                The extension does not silently submit arbitrary browsing data. Job content is processed only to provide
                the user-requested FYJOB analysis workflow.
              </p>
            </div>
          </section>

          <section className="space-y-3 rounded-2xl border border-border bg-card/70 p-6">
            <h2 className="text-xl font-semibold">3. How We Use Data</h2>
            <div className="space-y-3 text-sm leading-7 text-muted-foreground">
              <p>We use collected data to:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Authenticate users and sync access status across FYJOB services</li>
                <li>Generate job-match analysis, quizzes, learning paths, and interview practice</li>
                <li>Show analysis history and personalized recommendations</li>
                <li>Enforce feature access rules for Free, Basic, Pro, and Admin plans</li>
                <li>Maintain security, abuse prevention, performance monitoring, and service reliability</li>
              </ul>
            </div>
          </section>

          <section className="space-y-3 rounded-2xl border border-border bg-card/70 p-6">
            <h2 className="text-xl font-semibold">4. Third-Party Services</h2>
            <div className="space-y-3 text-sm leading-7 text-muted-foreground">
              <p>FYJOB may use trusted third-party services such as:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Supabase for authentication and session management</li>
                <li>Azure services for backend hosting, storage, and speech processing</li>
                <li>AI model providers used for analysis and coaching features</li>
              </ul>
            </div>
          </section>

          <section className="space-y-3 rounded-2xl border border-border bg-card/70 p-6">
            <h2 className="text-xl font-semibold">5. Data Retention and Plan Expiry</h2>
            <div className="space-y-3 text-sm leading-7 text-muted-foreground">
              <p>
                We retain user content and activity data as needed to provide FYJOB features, maintain account history,
                and support operational security.
              </p>
              <p>
                If a free trial or paid plan expires and is not renewed, access to premium-only features is removed and
                the account returns to the Free plan according to FYJOB plan rules.
              </p>
            </div>
          </section>

          <section className="space-y-3 rounded-2xl border border-border bg-card/70 p-6">
            <h2 className="text-xl font-semibold">6. Security</h2>
            <p className="text-sm leading-7 text-muted-foreground">
              We take reasonable technical and organizational measures to protect user data. However, no system can be
              guaranteed to be fully secure.
            </p>
          </section>

          <section className="space-y-3 rounded-2xl border border-border bg-card/70 p-6">
            <h2 className="text-xl font-semibold">7. Contact</h2>
            <p className="text-sm leading-7 text-muted-foreground">
              For privacy or support questions, contact us at <a className="text-primary underline-offset-4 hover:underline" href="mailto:okitr52@gmail.com">okitr52@gmail.com</a> or visit <a className="text-primary underline-offset-4 hover:underline" href="https://fyjob.my.id" target="_blank" rel="noreferrer">fyjob.my.id</a>.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
};

export default PrivacyPolicy;