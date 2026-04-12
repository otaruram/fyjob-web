import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import {
  adminAddUserCredits,
  adminSetUserBan,
  getAdminActivity,
  getAdminOverview,
  getAdminUsers,
  type AdminActivitySummary,
  type AdminOverview,
  type AdminUserRow,
} from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Ban, Coins, Search, Shield, Users, Activity } from "lucide-react";

const AdminCenter = () => {
  const { user } = useAuth();
  const isAllowedAdminEmail = (user?.email || "").trim().toLowerCase().replace(/\s+/g, "") === "okitr52@gmail.com";
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [activity, setActivity] = useState<AdminActivitySummary | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [search, setSearch] = useState("");
  const [creditInput, setCreditInput] = useState<Record<string, number>>({});

  const loadAll = async (searchValue = "") => {
    setLoading(true);
    try {
      if (!isAllowedAdminEmail) {
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      const [ov, act, us] = await Promise.all([
        getAdminOverview(),
        getAdminActivity(),
        getAdminUsers(searchValue, 40),
      ]);

      setIsAdmin(true);
      setOverview(ov);
      setActivity(act);
      setUsers(us.users || []);
    } catch (e: any) {
      if ((e?.message || "").toLowerCase().includes("admin")) {
        setIsAdmin(false);
      } else {
        toast.error(e?.message || "Failed to load admin center");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [isAllowedAdminEmail]);

  const handleSearch = async () => {
    try {
      const result = await getAdminUsers(search.trim(), 40);
      setUsers(result.users || []);
    } catch (e: any) {
      toast.error(e?.message || "Search failed");
    }
  };

  const handleBanToggle = async (user: AdminUserRow) => {
    try {
      const willBan = !Boolean(user.is_banned);
      await adminSetUserBan(user.id, willBan, willBan ? "Violation of platform policy" : "");
      toast.success(willBan ? "User banned" : "User unbanned");
      await loadAll(search.trim());
    } catch (e: any) {
      toast.error(e?.message || "Failed to update user status");
    }
  };

  const handleAddCredits = async (user: AdminUserRow) => {
    const amount = Number(creditInput[user.id] || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Input token harus lebih dari 0");
      return;
    }

    try {
      await adminAddUserCredits(user.id, amount);
      toast.success(`+${amount} token ditambahkan ke ${user.email}`);
      await loadAll(search.trim());
    } catch (e: any) {
      toast.error(e?.message || "Failed adding credits");
    }
  };

  const usageRows = useMemo(() => activity?.usage || [], [activity]);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex h-[60vh] items-center justify-center text-muted-foreground">Loading admin center...</div>
      </DashboardLayout>
    );
  }

  if (!isAdmin) {
    return (
      <DashboardLayout>
        <div className="mx-auto max-w-3xl rounded-xl border border-red-400/30 bg-red-500/10 p-6 text-center">
          <h1 className="text-xl font-semibold text-red-300">Admin access required</h1>
          <p className="mt-2 text-sm text-red-100/80">Halaman ini hanya bisa diakses admin.</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-4 sm:space-y-5">
        <div>
          <p className="terminal-kicker mb-2">admin command center</p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">FYJOB Admin Center</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">Ban user, monitor usage, top up token, and track activity patterns.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="terminal-shell p-4">
            <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Total Users</span><Users className="w-4 h-4 text-primary" /></div>
            <p className="text-2xl font-semibold mt-2">{overview?.total_users || 0}</p>
          </div>
          <div className="terminal-shell p-4">
            <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Banned Users</span><Ban className="w-4 h-4 text-red-400" /></div>
            <p className="text-2xl font-semibold mt-2">{overview?.banned_users || 0}</p>
          </div>
          <div className="terminal-shell p-4">
            <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Active (7 days)</span><Activity className="w-4 h-4 text-emerald-400" /></div>
            <p className="text-2xl font-semibold mt-2">{overview?.active_last_7_days || 0}</p>
          </div>
          <div className="terminal-shell p-4">
            <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Most Used Feature</span><Shield className="w-4 h-4 text-yellow-400" /></div>
            <p className="text-sm font-semibold mt-2">{overview?.most_used_feature?.feature || "-"}</p>
            <p className="text-xs text-muted-foreground">{overview?.most_used_feature?.count || 0} actions</p>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <section className="xl:col-span-2 terminal-shell p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between mb-4">
              <h2 className="text-lg font-semibold">User Management</h2>
              <div className="flex gap-2 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-72">
                  <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search email"
                    className="w-full rounded-lg border border-border bg-card pl-9 pr-3 py-2 text-sm"
                  />
                </div>
                <button onClick={handleSearch} className="px-3 sm:px-4 py-2 rounded-lg border border-border text-xs sm:text-sm hover:bg-card/60">Search</button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm min-w-[700px]">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-2 pr-2">Email</th>
                    <th className="py-2 pr-2">Role</th>
                    <th className="py-2 pr-2">Credits</th>
                    <th className="py-2 pr-2">Status</th>
                    <th className="py-2 pr-2">Token</th>
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-border/70">
                      <td className="py-2 pr-2">
                        <div className="font-medium break-all">{u.email || u.id}</div>
                        <div className="text-xs text-muted-foreground break-all">{u.id}</div>
                      </td>
                      <td className="py-2 pr-2">{u.role}</td>
                      <td className="py-2 pr-2">{u.role === "admin" ? "∞" : (u.credits_remaining ?? 0)}</td>
                      <td className="py-2 pr-2">{u.is_banned ? <span className="text-red-400">Banned</span> : <span className="text-emerald-400">Active</span>}</td>
                      <td className="py-2 pr-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            value={creditInput[u.id] || ""}
                            onChange={(e) => setCreditInput((prev) => ({ ...prev, [u.id]: Number(e.target.value) }))}
                            className="w-20 rounded-md border border-border bg-card px-2 py-1"
                            placeholder="10"
                          />
                          <button
                            onClick={() => handleAddCredits(u)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border hover:bg-card/60"
                          >
                            <Coins className="w-3.5 h-3.5" /> Add
                          </button>
                        </div>
                      </td>
                      <td className="py-2">
                        <button
                          onClick={() => handleBanToggle(u)}
                          disabled={u.role === "admin"}
                          className="px-2 py-1 rounded-md border border-border hover:bg-card/60 disabled:opacity-50"
                        >
                          {u.is_banned ? "Unban" : "Ban"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="terminal-shell p-4 sm:p-5">
            <h2 className="text-lg font-semibold mb-3">Feature Activity</h2>
            <p className="text-xs text-muted-foreground mb-3">Insight: yang paling sering dipakai dan yang paling jarang disentuh.</p>
            <div className="space-y-2">
              {usageRows.map((row) => (
                <div key={row.feature} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{row.feature}</span>
                    <span className="text-primary font-semibold">{row.count}</span>
                  </div>
                </div>
              ))}
              {!usageRows.length && <p className="text-sm text-muted-foreground">No data yet.</p>}
            </div>

            <div className="mt-4 rounded-lg border border-border p-3 text-sm">
              <p className="text-muted-foreground">Least used</p>
              <p className="font-semibold">{activity?.least_used?.feature || "-"}</p>
            </div>
          </section>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default AdminCenter;
