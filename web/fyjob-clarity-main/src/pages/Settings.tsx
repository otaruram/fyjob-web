import { useState } from "react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { User, Bell, Shield, Palette } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/contexts/AuthContext";

const Settings = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("profile");

  return (
    <DashboardLayout>
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 border-b border-border pb-6">
             <h1 className="text-3xl font-bold tracking-tight mb-2">{t('set_title')}</h1>
             <p className="text-muted-foreground">{t('set_desc')}</p>
          </div>

          <div className="flex flex-col md:flex-row gap-8">
            <aside className="w-full md:w-64 shrink-0">
               <nav className="flex flex-col gap-1">
                 <button 
                   onClick={() => setActiveTab("profile")}
                   className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'profile' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-card/50 hover:text-foreground'}`}
                 >
                   <User className="h-4 w-4" /> {t('set_tab_prof')}
                 </button>
                 <button 
                   onClick={() => setActiveTab("appearance")}
                   className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'appearance' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-card/50 hover:text-foreground'}`}
                 >
                   <Palette className="h-4 w-4" /> {t('set_tab_app')}
                 </button>
                 <button 
                   onClick={() => setActiveTab("notifications")}
                   className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'notifications' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-card/50 hover:text-foreground'}`}
                 >
                   <Bell className="h-4 w-4" /> {t('set_tab_notif')}
                 </button>
                 <button 
                   onClick={() => setActiveTab("security")}
                   className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'security' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-card/50 hover:text-foreground'}`}
                 >
                   <Shield className="h-4 w-4" /> {t('set_tab_sec')}
                 </button>
               </nav>
            </aside>

            <div className="flex-1">
               {activeTab === 'profile' && (
                 <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                    <div className="glass rounded-xl p-6">
                       <h2 className="text-lg font-semibold mb-4">{t('set_tab_prof')}</h2>
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
                          <button className="bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium px-6 py-2.5 rounded-lg transition-colors shadow-glow mt-2">
                             Save Changes
                          </button>
                       </div>
                    </div>
                 </div>
               )}
               {activeTab === 'appearance' && (
                 <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                    <div className="glass rounded-xl p-6">
                       <h2 className="text-lg font-semibold mb-4">{t('set_tab_app')}</h2>
                       <p className="text-sm text-muted-foreground mb-4">FYJOB currently operates strictly in Deep Space Black (Micro-Enterprise Standard).</p>
                       <div className="flex gap-4">
                          <div className="border-2 border-primary rounded-xl p-1 w-32 cursor-pointer">
                             <div className="bg-background h-20 rounded-lg flex items-center justify-center border border-border">
                               <span className="text-xs font-semibold text-primary">Dark Default</span>
                             </div>
                          </div>
                       </div>
                    </div>
                 </div>
               )}
               {(activeTab === 'notifications' || activeTab === 'security') && (
                 <div className="glass rounded-xl p-6 animate-in fade-in slide-in-from-right-4 duration-300">
                    <h2 className="text-lg font-semibold mb-4">{activeTab === 'security' ? t('set_tab_sec') : t('set_tab_notif')}</h2>
                    <p className="text-sm text-muted-foreground">Configurable settings coming in next deployment.</p>
                 </div>
               )}
            </div>
          </div>
        </div>
    </DashboardLayout>
  );
};

export default Settings;
