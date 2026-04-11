import { useState, useEffect } from "react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { Bell, ArrowLeft, Mail, TriangleAlert, CheckCircle2, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { getAuthToken } from "@/lib/api";
import { toast } from "sonner";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:7071";

interface AlertPrefs {
  email_weekly_summary: boolean;
  email_new_quiz: boolean;
  email_security_warnings: boolean;
  threshold_low_score: number;
  daily_reminder_time: string;
}

const DEFAULT: AlertPrefs = {
  email_weekly_summary: true,
  email_new_quiz: true,
  email_security_warnings: true,
  threshold_low_score: 60,
  daily_reminder_time: "20:00",
};

const Alerts = () => {
  const [prefs, setPrefs] = useState<AlertPrefs>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testEmailSent, setTestEmailSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const token = await getAuthToken();
        const res = await fetch(`${API_BASE}/api/alert-settings`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setPrefs({ ...DEFAULT, ...data.alert_prefs });
        }
      } catch (e) {
        // silently use defaults if offline
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const token = await getAuthToken();
      const res = await fetch(`${API_BASE}/api/alert-settings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(prefs),
      });
      if (!res.ok) throw new Error("Save failed");
      setSaved(true);
      toast.success("Alert settings saved");
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Failed to save. Please try again.");
      toast.error("Failed to save alert settings");
    } finally {
      setSaving(false);
    }
  };

  const handleSendTestEmail = async () => {
    setTestingEmail(true);
    setError(null);
    setTestEmailSent(false);
    try {
      const token = await getAuthToken();
      const res = await fetch(`${API_BASE}/api/alert-settings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...prefs, send_test_email: true }),
      });
      if (!res.ok) throw new Error("Test email failed");
      const data = await res.json();
      setTestEmailSent(Boolean(data?.email_test_sent));
      if (!data?.email_test_sent) {
        setError("Test email was requested but not sent. Check sender/domain verification in ACS.");
        toast.error("Test email not sent. Check ACS sender/domain verification");
      } else {
        toast.success("Test email sent");
      }
    } catch {
      setError("Failed to send test email.");
      toast.error("Failed to send test email");
    } finally {
      setTestingEmail(false);
    }
  };

  const toggle = (key: keyof AlertPrefs) =>
    setPrefs((p) => ({ ...p, [key]: !p[key] }));

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div>
            <p className="terminal-kicker mb-2">notification controls</p>
            <h1 className="text-3xl font-bold tracking-tight mb-2">Alerts</h1>
            <p className="text-muted-foreground">Control notification rules for account and job activity.</p>
          </div>
          <Link
            to="/dashboard/settings"
            className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-border hover:bg-card/60 w-fit"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Settings
          </Link>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading preferences…
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Email Alerts */}
              <div className="terminal-shell p-4 sm:p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Mail className="w-4 h-4 text-primary" />
                  <h2 className="font-semibold">Email Alerts</h2>
                  <span className="terminal-chip ml-auto">ACS Email</span>
                </div>
                <div className="space-y-3 text-sm">
                  {([
                    ["email_weekly_summary", "Weekly performance summary"],
                    ["email_new_quiz", "New quiz availability"],
                    ["email_security_warnings", "Security sign-in warnings"],
                  ] as [keyof AlertPrefs, string][]).map(([key, label]) => (
                    <label key={key} className="flex items-center justify-between gap-3 cursor-pointer">
                      <span>{label}</span>
                      <input
                        type="checkbox"
                        checked={prefs[key] as boolean}
                        onChange={() => toggle(key)}
                        className="h-4 w-4 accent-primary"
                      />
                    </label>
                  ))}
                </div>
              </div>

              {/* Threshold Alerts */}
              <div className="terminal-shell p-4 sm:p-6">
                <div className="flex items-center gap-2 mb-4">
                  <TriangleAlert className="w-4 h-4 text-yellow-500" />
                  <h2 className="font-semibold">Threshold Alerts</h2>
                </div>
                <div className="space-y-4 text-sm">
                  <div>
                    <label className="text-muted-foreground block mb-1">Low score threshold (%)</label>
                    <input
                      type="number"
                      value={prefs.threshold_low_score}
                      min={0}
                      max={100}
                      onChange={(e) =>
                        setPrefs((p) => ({ ...p, threshold_low_score: Number(e.target.value) }))
                      }
                      className="w-full bg-card border border-border rounded-lg px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="text-muted-foreground block mb-1">Daily reminder time</label>
                    <input
                      type="time"
                      value={prefs.daily_reminder_time}
                      onChange={(e) =>
                        setPrefs((p) => ({ ...p, daily_reminder_time: e.target.value }))
                      }
                      className="w-full bg-card border border-border rounded-lg px-3 py-2"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="terminal-shell p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0">
                {saved ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    <span className="text-green-500">Preferences saved!</span>
                  </>
                ) : testEmailSent ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    <span className="text-green-500">Test email sent successfully.</span>
                  </>
                ) : (
                  <>
                    <Bell className="w-4 h-4" />
                    Emails sent via Azure Communication Services.
                  </>
                )}
              </div>
              <div className="flex flex-col sm:items-end gap-2 w-full sm:w-auto">
                <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                  <button
                    onClick={handleSendTestEmail}
                    disabled={testingEmail || saving}
                    className="border border-border hover:bg-card/70 disabled:opacity-60 text-foreground text-sm font-medium px-5 py-2 rounded-lg transition-colors flex items-center justify-center gap-2 w-full sm:w-auto"
                  >
                    {testingEmail && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Send Test Email
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving || testingEmail}
                    className="bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground text-sm font-medium px-5 py-2 rounded-lg transition-colors flex items-center justify-center gap-2 w-full sm:w-auto"
                  >
                    {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Save Alerts
                  </button>
                </div>
                {error && <p className="text-xs text-red-500">{error}</p>}
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
};

export default Alerts;
