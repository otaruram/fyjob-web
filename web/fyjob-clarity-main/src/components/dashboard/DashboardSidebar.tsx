import { LayoutDashboard, FileText, History, BookOpen, Swords, Settings, LogOut } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/contexts/AuthContext";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarFooter, useSidebar } from "@/components/ui/sidebar";

const DashboardSidebar = () => {
  const { state } = useSidebar();
  const { t } = useTranslation();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const collapsed = state === "collapsed";
  const location = useLocation();

  const navItems = [
    { title: t('side_overview'), url: "/dashboard", icon: LayoutDashboard },
    { title: t('side_cv'), url: "/dashboard/cv", icon: FileText },
    { title: t('side_history'), url: "/dashboard/applications", icon: History },
    { title: t('side_study'), url: "/dashboard/study", icon: BookOpen },
    { title: t('side_quiz'), url: "/dashboard/quiz", icon: Swords },
    { title: t('side_settings'), url: "/dashboard/settings", icon: Settings },
  ];

  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-border">
      <div className="h-16 flex items-center px-4 border-b border-border">
        {!collapsed && (
          <span className="text-lg font-bold text-foreground tracking-tight">
            FY<span className="gradient-text">JOB</span>
          </span>
        )}
        {collapsed && <span className="text-lg font-bold gradient-text mx-auto">F</span>}
      </div>

      <SidebarContent className="mt-2">
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs text-muted-foreground uppercase tracking-wider">
            {!collapsed && "Menu"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/dashboard"}
                      className="hover:bg-muted/50 rounded-lg"
                      activeClassName="bg-primary/10 text-primary font-medium"
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
      </SidebarContent>

      <SidebarFooter className="border-t border-border p-3">
        <SidebarMenuButton asChild>
          <button onClick={handleLogout} className="flex items-center w-full hover:bg-red-500/10 rounded-lg text-muted-foreground hover:text-red-400 transition-colors px-2 py-2">
            <LogOut className="h-4 w-4 mr-3 shrink-0" />
            {!collapsed && <span className="text-sm">{t('side_logout')}</span>}
          </button>
        </SidebarMenuButton>
      </SidebarFooter>
    </Sidebar>
  );
};

export default DashboardSidebar;
