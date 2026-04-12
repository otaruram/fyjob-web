import { useState, useEffect } from "react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { Bell, ArrowLeft, Mail, TriangleAlert, CheckCircle2, Loader2, Shield, CalendarClock, BrainCircuit } from "lucide-react";
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
  email_weekly_summary: false,
  email_new_quiz: false,
  email_security_warnings: false,
  threshold_low_score: 60,
  daily_reminder_time: "20:00",
};

const EMAIL_ALERT_ITEMS: Array<{
  key: keyof Pick<AlertPrefs, "email_weekly_summary" | "email_new_quiz" | "email_security_warnings">;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    key: "email_weekly_summary",
    title: "Weekly summary",
    description: "Recap of score trend, activity, and skill gaps.",
    icon: CalendarClock,
  },
  {
    key: "email_new_quiz",
    title: "New quiz ready",
    description: "Notify when fresh practice questions are available.",
    icon: BrainCircuit,
  },
  {
    key: "email_security_warnings",
    title: "Security warning",
    description: "Alert for suspicious sign-in activity.",
    icon: Shield,
  },
];

const Alerts = () => {
  const [prefs, setPrefs] = useState<AlertPrefs>(DEFAULT);
  const [isAdmin, setIsAdmin] = useState(false);
  const [testEmailTo, setTestEmailTo] = useState("okitr52@gmail.com");
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
          setIsAdmin(Boolean(data?.is_admin));
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
        body: JSON.stringify({
          ...prefs,
          send_test_email: true,
          ...(isAdmin ? { test_email_to: testEmailTo.trim() } : {}),
        }),
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
                </div>
                <p className="text-xs text-muted-foreground mb-4">
                  Default semua OFF. Aktifkan yang dibutuhkan saja.
                </p>
                <div className="space-y-3 text-sm">
                  {EMAIL_ALERT_ITEMS.map((item) => {
                    const enabled = Boolean(prefs[item.key]);
                    const Icon = item.icon;

                    return (
                      <div
                        key={item.key}
                        className={`rounded-lg border p-3 transition-colors ${
                          enabled ? "border-primary/50 bg-primary/5" : "border-border bg-card/30"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <Icon className={`w-4 h-4 ${enabled ? "text-primary" : "text-muted-foreground"}`} />
                              <p className="font-medium leading-5">{item.title}</p>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">{item.description}</p>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={enabled}
                            onClick={() => toggle(item.key)}
                            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
                              enabled ? "bg-primary border-primary" : "bg-muted border-border"
                            }`}
                          >
                            <span
                              className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                                enabled ? "translate-x-5" : "translate-x-0"
                              }`}
                            />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Threshold Alerts */}
              <div className="terminal-shell p-4 sm:p-6">
                <div className="flex items-center gap-2 mb-4">
                  <TriangleAlert className="w-4 h-4 text-yellow-500" />
                  <h2 className="font-semibold">Threshold</h2>
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

                  <div className="rounded-lg border border-border bg-card/20 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Reminder preview</p>
                    <p className="mt-2 text-sm font-medium text-foreground">Waktunya level up karier kamu</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Jam {prefs.daily_reminder_time || "20:00"} kami kirim pengingat ringan. Ayo analisis 1 lowongan hari ini,
                      update score kamu, lalu lanjut latihan interview.
                    </p>
                  </div>

                  <div className="rounded-lg border border-border bg-card/20 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Weekly message preview</p>
                    <p className="mt-2 text-sm font-medium text-foreground">Ringkasan performa mingguan FYJOB</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Minggu ini kami rangkum trend match score, progress quiz, dan gap skill utama.
                      Fokuskan minggu depan pada area dengan nilai di bawah {prefs.threshold_low_score}%.
                    </p>
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
                  {isAdmin && (
                    <input
                      type="email"
                      value={testEmailTo}
                      onChange={(e) => setTestEmailTo(e.target.value)}
                      placeholder="Target test email"
                      className="w-full sm:w-64 bg-card border border-border rounded-lg px-3 py-2 text-sm"
                    />
                  )}
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
