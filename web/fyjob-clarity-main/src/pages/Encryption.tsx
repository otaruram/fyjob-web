import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { Shield, Lock, KeyRound, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

const Encryption = () => {
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div>
            <p className="terminal-kicker mb-2">data protection</p>
            <h1 className="text-3xl font-bold tracking-tight mb-2">Encryption</h1>
            <p className="text-muted-foreground">Review current encryption posture for CV and account data.</p>
          </div>
          <Link
            to="/dashboard/settings"
            className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-border hover:bg-card/60 w-fit"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Settings
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="terminal-shell p-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold">At Rest</h2>
              <Lock className="w-4 h-4 text-success" />
            </div>
            <p className="text-sm text-muted-foreground">Blob and database encryption active by platform default.</p>
            <p className="text-xs mt-3 text-success">Status: Enabled</p>
          </div>

          <div className="terminal-shell p-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold">In Transit</h2>
              <Shield className="w-4 h-4 text-success" />
            </div>
            <p className="text-sm text-muted-foreground">API traffic is secured with HTTPS and bearer authentication.</p>
            <p className="text-xs mt-3 text-success">Status: TLS enforced</p>
          </div>

          <div className="terminal-shell p-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold">Key Rotation</h2>
              <KeyRound className="w-4 h-4 text-warning" />
            </div>
            <p className="text-sm text-muted-foreground">Set periodic rotation reminders for API and signing keys.</p>
            <p className="text-xs mt-3 text-warning">Status: Review recommended</p>
          </div>
        </div>

        <div className="terminal-shell p-6">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h3 className="font-semibold">Operational Guidance</h3>
            <span className="terminal-chip">Security baseline</span>
          </div>
          <ul className="text-sm text-muted-foreground space-y-2 list-disc pl-5">
            <li>Rotate LLM and JWT secrets every 60-90 days.</li>
            <li>Restrict CORS to trusted origins only.</li>
            <li>Prefer private blob access with short-lived SAS URLs.</li>
          </ul>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Encryption;
