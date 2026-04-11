import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import DashboardSidebar from "./DashboardSidebar";
import { UjangChatPanel } from "./UjangChatPanel";
import { useAuth } from "@/contexts/AuthContext";
import { LogOut } from "lucide-react";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

const DashboardLayout = ({ children }: DashboardLayoutProps) => {
  const { user, signOut } = useAuth();

  return (
  <SidebarProvider>
    <div className="min-h-screen flex w-full">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col min-w-0">
          <header className="min-h-16 flex items-center justify-between border-b border-border px-3 sm:px-4 glass-strong sticky top-0 z-30">
           <div className="flex items-center min-w-0">
             <SidebarTrigger className="mr-2 sm:mr-4" />
             <span className="text-xs sm:text-sm font-medium text-foreground tracking-widest uppercase truncate">FYJOB Terminal</span>
          </div>
           <div className="flex items-center gap-2 sm:gap-3">
            {/* User email badge */}
            {user && (
              <span className="text-[10px] font-mono text-muted-foreground hidden sm:inline-block truncate max-w-[180px]">
                {user.email}
              </span>
            )}
            {/* Logout button */}
            <button
              onClick={signOut}
              className="text-muted-foreground hover:text-red-400 transition-colors p-1.5 rounded-md hover:bg-red-500/10"
              title="Sign Out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6 overflow-y-auto">{children}</main>
      </div>
      <UjangChatPanel />
    </div>
  </SidebarProvider>
  );
};

export default DashboardLayout;
