import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { User, Bell, Shield, ArrowRight, Headset, Linkedin, Mail, MessageCircle, ExternalLink } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/contexts/AuthContext";
import { Link } from "react-router-dom";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const SUPPORT_EMAIL = "okitr52@gmail.com";
const SUPPORT_LINKEDIN = "https://www.linkedin.com/in/otaruram/";
const SUPPORT_WA_URL = "https://wa.me/6285797968246?text=Halo%20FYJOB%20Support%2C%20saya%20butuh%20bantuan%20terkait%20akun%2Ffitur.%20Mohon%20dibantu%20ya.";
const SUPPORT_EMAIL_URL = `mailto:${SUPPORT_EMAIL}?subject=FYJOB%20Support&body=Halo%20FYJOB%20Support,%20saya%20butuh%20bantuan%20terkait%20akun%20atau%20fitur.`;

const supportItems = [
  {
    title: "Email",
    subtitle: SUPPORT_EMAIL,
    href: SUPPORT_EMAIL_URL,
    icon: Mail,
    accent: "text-sky-400",
    surface: "bg-sky-500/10 border-sky-500/20 hover:bg-sky-500/15",
    actionLabel: "Open email draft",
  },
  {
    title: "WhatsApp",
    subtitle: "085797968246",
    href: SUPPORT_WA_URL,
    icon: MessageCircle,
    accent: "text-emerald-400",
    surface: "bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/15",
    actionLabel: "Open WhatsApp chat",
  },
  {
    title: "LinkedIn",
    subtitle: "linkedin.com/in/otaruram",
    href: SUPPORT_LINKEDIN,
    icon: Linkedin,
    accent: "text-blue-400",
    surface: "bg-blue-500/10 border-blue-500/20 hover:bg-blue-500/15",
    actionLabel: "Open LinkedIn profile",
  },
] as const;

const Settings = () => {
  const { t } = useTranslation();
  const { user } = useAuth();

  return (
    <DashboardLayout>
        <div className="mx-auto max-w-6xl">
          <div className="mb-6 sm:mb-8 border-b border-border pb-5 sm:pb-6">
             <p className="terminal-kicker mb-2">terminal settings</p>
             <h1 className="text-3xl font-bold tracking-tight mb-2">{t('set_title')}</h1>
             <p className="text-muted-foreground">{t('set_desc')}</p>
          </div>

          <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">
            <aside className="w-full lg:w-72 shrink-0">
               <nav className="flex flex-col gap-1">
                 <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium bg-primary/10 text-primary border border-primary/20">
                   <User className="h-4 w-4" /> {t('set_tab_prof')}
                 </div>
                 <Link
                   to="/dashboard/settings/alerts"
                   className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-muted-foreground border border-transparent hover:bg-card/60 hover:border-border hover:text-foreground transition-all"
                 >
                   <span className="flex items-center gap-3">
                     <Bell className="h-4 w-4" /> Alerts
                   </span>
                   <ArrowRight className="h-4 w-4" />
                 </Link>
                 <Link
                   to="/dashboard/settings/encryption"
                   className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-muted-foreground border border-transparent hover:bg-card/60 hover:border-border hover:text-foreground transition-all"
                 >
                   <span className="flex items-center gap-3">
                     <Shield className="h-4 w-4" /> Encryption
                   </span>
                   <ArrowRight className="h-4 w-4" />
                 </Link>
               </nav>
            </aside>

            <div className="flex-1">
               <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                <div className="terminal-shell p-4 sm:p-6">
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <h2 className="text-lg font-semibold">{t('set_tab_prof')}</h2>
                    <span className="terminal-chip">Synced account</span>
                  </div>
                     <div className="space-y-4">
                        <div>
                          <label className="text-sm font-medium text-muted-foreground block mb-1.5">Full Name</label>
                          <input type="text" defaultValue={user?.user_metadata?.full_name || ''} className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-primary/50 transition-colors" />
                        </div>
                        <div>
                          <label className="text-sm font-medium text-muted-foreground block mb-1.5">Email Address</label>
                          <input type="email" defaultValue={user?.email || ''} className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-primary/50 transition-colors" disabled />
                          <p className="text-xs text-muted-foreground mt-1.5">Managed by your Google account.</p>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-muted-foreground block mb-1.5">Auth Provider</label>
                          <input type="text" defaultValue={user?.app_metadata?.provider || 'google'} className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-primary/50 transition-colors capitalize" disabled />
                        </div>
                        <button className="bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium px-5 sm:px-6 py-2.5 rounded-lg transition-colors shadow-glow mt-2 w-full sm:w-auto">
                           Save Changes
                        </button>
                     </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Link to="/dashboard/settings/alerts" className="terminal-shell p-5 hover:border-primary/40 transition-colors">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-semibold">Alerts</h3>
                        <Bell className="w-4 h-4 text-primary" />
                      </div>
                      <p className="text-sm text-muted-foreground">Configure notification preferences and event alert thresholds.</p>
                    </Link>
                    <Link to="/dashboard/settings/encryption" className="terminal-shell p-5 hover:border-primary/40 transition-colors">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-semibold">Encryption</h3>
                        <Shield className="w-4 h-4 text-primary" />
                      </div>
                      <p className="text-sm text-muted-foreground">Review data protection status and key rotation guidance.</p>
                    </Link>
                  </div>

                  <div className="terminal-shell p-5 sm:p-6">
                    <div className="flex items-start justify-between gap-3 mb-5">
                      <div>
                        <h2 className="text-lg font-semibold flex items-center gap-2">
                          <Headset className="h-5 w-5 text-primary" /> Support
                        </h2>
                        <p className="text-sm text-muted-foreground mt-1">
                          Need help with login, billing, or feature issues? Pick a channel below and we will route you to the right contact.
                        </p>
                      </div>
                      <span className="terminal-chip">Fast contact</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      {supportItems.map((item) => {
                        const Icon = item.icon;

                        return (
                          <Popover key={item.title}>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                aria-label={`Open ${item.title} support`}
                                className={`group flex h-14 w-14 items-center justify-center rounded-2xl border transition-all ${item.surface}`}
                              >
                                <Icon className={`h-5 w-5 ${item.accent}`} />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="w-[min(90vw,320px)] border-border bg-card/95 backdrop-blur-xl p-4">
                              <div className="space-y-3">
                                <div>
                                  <p className="text-sm font-semibold text-foreground">{item.title} Support</p>
                                  <p className="text-xs text-muted-foreground mt-1">{item.subtitle}</p>
                                </div>
                                <p className="text-sm text-muted-foreground">
                                  Send a quick message and include your account email plus a short note about the issue so support can respond faster.
                                </p>
                                <a
                                  href={item.href}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                                >
                                  {item.actionLabel}
                                  <ExternalLink className="h-4 w-4" />
                                </a>
                              </div>
                            </PopoverContent>
                          </Popover>
                        );
                      })}
                    </div>
                  </div>
               </div>
            </div>
          </div>
        </div>
    </DashboardLayout>
  );
};

export default Settings;
