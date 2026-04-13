import { useEffect, useState } from "react";
import { LayoutDashboard, FileText, History, BookOpen, Swords, Settings, LogOut, Mic, Crown, Shield, Sparkles } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/contexts/AuthContext";
import { getAnalysisHistory, getUserStats } from "@/lib/api";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarFooter, useSidebar } from "@/components/ui/sidebar";

const ADMIN_EMAIL = (import.meta.env.VITE_ADMIN_EMAIL || "okitr52@gmail.com").trim().toLowerCase().replace(/\s+/g, "");

const DashboardSidebar = () => {
  const { state } = useSidebar();
  const { t } = useTranslation();
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const collapsed = state === "collapsed";
  const isAllowedAdminEmail = (user?.email || "").trim().toLowerCase().replace(/\s+/g, "") === ADMIN_EMAIL;
  const [hasAnalysis, setHasAnalysis] = useState(false);
  const [planBadge, setPlanBadge] = useState<string>("FREE");
  const [interviewEnabled, setInterviewEnabled] = useState(false);
  const isAdmin = isAllowedAdminEmail;

  useEffect(() => {
    const checkAnalysis = async () => {
      try {
        const items = await getAnalysisHistory(1, 0);
        setHasAnalysis(Array.isArray(items) && items.length > 0);
      } catch {
        setHasAnalysis(false);
      }
    };

    checkAnalysis();
  }, []);

  useEffect(() => {
    const loadPlanBadge = async () => {
      try {
        const stats = await getUserStats();
        const normalized = String(stats?.plan || "free").toUpperCase();
        setPlanBadge(normalized === "ADMIN" ? "ADMIN" : normalized);
        const adminMode = stats?.role === "admin" || isAllowedAdminEmail;
        setInterviewEnabled(Boolean(stats?.interview_access?.enabled || adminMode));
      } catch {
        setPlanBadge("FREE");
        setInterviewEnabled(isAllowedAdminEmail);
      }
    };

    loadPlanBadge();

    const onFocus = () => {
      loadPlanBadge();
    };
    const timer = window.setInterval(loadPlanBadge, 45000);
    window.addEventListener("focus", onFocus);

    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, []);

  const navGroups = [
    {
      label: "Core",
      items: [
        { title: t('side_overview'), url: "/dashboard", icon: LayoutDashboard },
      ],
    },
    {
      label: "Career Tools",
      items: [
        { title: t('side_cv'), url: "/dashboard/cv", icon: FileText },
        { title: t('side_history'), url: "/dashboard/applications", icon: History },
        { title: t('side_study'), url: "/dashboard/study", icon: BookOpen },
        { title: t('side_quiz'), url: "/dashboard/quiz", icon: Swords },
      ],
    },
    {
      label: "Account",
      items: [
        { title: "Upgrade Plan", url: "/dashboard/upgrade", icon: Sparkles },
        { title: t('side_settings'), url: "/dashboard/settings", icon: Settings },
        ...(isAdmin ? [{ title: "Admin Center", url: "/dashboard/admin", icon: Shield }] : []),
      ],
    },
  ];

  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-border bg-background">
      <div className="h-16 flex items-center px-4 border-b border-border/70">
        {!collapsed ? (
          <span className="text-lg font-bold text-foreground tracking-tight flex items-center gap-2">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary w-5 h-5 shrink-0">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
              <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
              <circle cx="12" cy="14" r="3"></circle>
              <path d="M14 16l3 3"></path>
            </svg>
            <span>FY<span className="text-primary">JOB</span></span>
            <span className="ml-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              {planBadge}
            </span>
          </span>
        ) : (
          <span className="flex items-center justify-center w-full">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary w-6 h-6">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
              <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
              <circle cx="12" cy="14" r="3"></circle>
              <path d="M14 16l3 3"></path>
            </svg>
          </span>
        )}
      </div>

      <SidebarContent className={`mt-2 space-y-2 ${collapsed ? "px-1" : "px-2"}`}>
        {navGroups.map((group) => (
          <SidebarGroup key={group.label} className={collapsed ? "px-0 py-1" : "rounded-xl border border-border/60 bg-card/35 px-2 py-2"}>
            <SidebarGroupLabel className="px-2 text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
              {!collapsed && group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="space-y-1">
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        end={item.url === "/dashboard"}
                        className={collapsed
                          ? "mx-auto flex h-9 w-9 items-center justify-center rounded-md border border-transparent transition-all hover:bg-muted/60"
                          : "rounded-lg border border-transparent px-2.5 py-2 transition-all hover:border-border/70 hover:bg-muted/50"
                        }
                        activeClassName={collapsed
                          ? "mx-auto flex h-9 w-9 items-center justify-center rounded-md border border-primary/40 bg-primary/10 text-primary"
                          : "rounded-lg border border-primary/30 bg-primary/12 text-primary shadow-sm shadow-primary/10 font-medium"
                        }
                      >
                        <item.icon className={`h-4 w-4 shrink-0 ${collapsed ? "mr-0" : "mr-3"}`} />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}

        <SidebarGroup className={collapsed ? "px-0 py-1" : "rounded-xl border border-primary/25 bg-primary/5 px-2 py-2"}>
          <SidebarGroupLabel className="px-2 text-[10px] text-primary uppercase tracking-[0.2em] flex items-center gap-1.5">
            {!collapsed && (
              <>
                <Crown className="h-3 w-3" /> Premium
              </>
            )}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-1">
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  {interviewEnabled ? (
                    <NavLink
                      to="/dashboard/interview-lite"
                      className={collapsed
                        ? "mx-auto flex h-9 w-9 items-center justify-center rounded-md border border-transparent transition-all hover:bg-muted/60"
                        : "rounded-lg border border-transparent px-2.5 py-2 transition-all hover:border-border/70 hover:bg-muted/50"
                      }
                      activeClassName={collapsed
                        ? "mx-auto flex h-9 w-9 items-center justify-center rounded-md border border-primary/40 bg-primary/10 text-primary"
                        : "rounded-lg border border-primary/30 bg-primary/12 text-primary shadow-sm shadow-primary/10 font-medium"
                      }
                    >
                      <Mic className={`h-4 w-4 shrink-0 ${collapsed ? "mr-0" : "mr-3"}`} />
                      {!collapsed && <span>AI Interview Lite</span>}
                    </NavLink>
                  ) : (
                    <button
                      disabled
                      className={collapsed
                        ? "mx-auto flex h-9 w-9 items-center justify-center rounded-md border border-dashed border-border/60 text-muted-foreground/70"
                        : "flex w-full items-center rounded-lg border border-dashed border-border/60 px-2.5 py-2 text-muted-foreground/70"
                      }
                      title="Interview Lite requires active plan/event access"
                    >
                      <Mic className={`h-4 w-4 shrink-0 ${collapsed ? "mr-0" : "mr-3"}`} />
                      {!collapsed && <span>AI Interview Lite (Locked Plan/Event)</span>}
                    </button>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            {!collapsed && interviewEnabled && !hasAnalysis && (
              <p className="px-2.5 pt-1 text-[11px] text-muted-foreground">Scan minimal 1 job dulu untuk mulai interview.</p>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-border/70 p-3">
        <SidebarMenuButton asChild>
          <button onClick={handleLogout} className="flex items-center w-full rounded-lg border border-transparent px-2 py-2 text-muted-foreground transition-all hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-400">
            <LogOut className="h-4 w-4 mr-3 shrink-0" />
            {!collapsed && <span className="text-sm">{t('side_logout')}</span>}
          </button>
        </SidebarMenuButton>
      </SidebarFooter>
    </Sidebar>
  );
};

export default DashboardSidebar;
