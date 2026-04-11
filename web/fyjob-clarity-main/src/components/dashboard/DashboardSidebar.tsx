import { LayoutDashboard, FileText, History, BookOpen, Swords, Settings, LogOut } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/contexts/AuthContext";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarFooter, useSidebar } from "@/components/ui/sidebar";

const DashboardSidebar = () => {
  const { state } = useSidebar();
  const { t } = useTranslation();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const collapsed = state === "collapsed";

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
      label: "Configuration",
      items: [
        { title: t('side_settings'), url: "/dashboard/settings", icon: Settings },
      ],
    },
  ];

  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-border bg-gradient-to-b from-background via-background to-muted/20">
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
              Pro
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

      <SidebarContent className="mt-2 space-y-2 px-2">
        {navGroups.map((group) => (
          <SidebarGroup key={group.label} className="rounded-xl border border-border/60 bg-card/35 px-2 py-2">
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
                        className="rounded-lg border border-transparent px-2.5 py-2 transition-all hover:border-border/70 hover:bg-muted/50"
                        activeClassName="rounded-lg border border-primary/30 bg-primary/12 text-primary shadow-sm shadow-primary/10 font-medium"
                      >
                        <item.icon className="h-4 w-4 mr-3 shrink-0" />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
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
