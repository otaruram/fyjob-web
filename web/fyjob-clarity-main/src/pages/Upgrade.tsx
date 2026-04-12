import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Check, Sparkles, Loader2, AlertCircle, Crown, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { getPaymentStatus, createPaymentTransaction, PaymentStatus, PlanInfo } from "@/lib/api";

const PLAN_ICONS: Record<string, React.ReactNode> = {
  free: <Zap className="h-5 w-5 text-muted-foreground" />,
  basic: <Sparkles className="h-5 w-5 text-blue-400" />,
  pro: <Crown className="h-5 w-5 text-yellow-400" />,
};

export default function Upgrade() {
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  const [status, setStatus] = useState<PaymentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const paymentResult = searchParams.get("payment");

  useEffect(() => {
    if (paymentResult === "success") {
      toast({
        title: "Pembayaran berhasil!",
        description: "Paketmu sedang diaktifkan. Muat ulang halaman dalam beberapa detik.",
      });
    } else if (paymentResult === "cancel") {
      toast({
        title: "Pembayaran dibatalkan",
        description: "Kamu bisa mencoba lagi kapan saja.",
        variant: "destructive",
      });
    }
  }, [paymentResult, toast]);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getPaymentStatus();
        setStatus(data);
      } catch (e: any) {
        setError(e.message || "Gagal memuat data");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleCheckout = async (planId: string) => {
    if (planId === "free") return;
    setCheckoutLoading(planId);
    try {
      const result = await createPaymentTransaction(
        planId as "basic" | "pro",
        `${window.location.origin}/dashboard/upgrade?payment=success`,
        `${window.location.origin}/dashboard/upgrade?payment=cancel`
      );
      if (result.checkout_url) {
        window.location.href = result.checkout_url;
      } else if (result.actions?.length) {
        const actionUrl = result.actions.find((a) => a.url)?.url;
        if (actionUrl) {
          window.location.href = actionUrl;
          return;
        }
        throw new Error("Link pembayaran belum tersedia. Coba ganti metode pembayaran.");
      } else if (result.payment_number || result.qr_string) {
        throw new Error("Transaksi QR berhasil dibuat, tapi link checkout tidak tersedia. Coba metode pembayaran selain QRIS.");
      } else {
        throw new Error("Checkout URL tidak tersedia");
      }
    } catch (e: any) {
      toast({
        title: "Gagal membuat transaksi",
        description: e.message || "Coba lagi nanti",
        variant: "destructive",
      });
      setCheckoutLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3 text-center px-4">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          Coba Lagi
        </Button>
      </div>
    );
  }

  const currentPlan = status?.current_plan ?? "free";
  const isAdmin = status?.is_admin ?? false;
  const plans: PlanInfo[] = status?.available_plans ?? [];

  const formatExpiry = (iso?: string | null) => {
    if (!iso) return null;
    try {
      return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
    } catch {
      return iso;
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <p className="terminal-kicker mb-2">upgrade</p>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
          Pilih Paket Battle Plan
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Start free, upgrade kalau butuh interview coaching lebih dalam dan limit lebih tinggi.
        </p>
      </motion.div>

      {/* Current plan banner */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.07 }}
        className="rounded-xl border border-border bg-card/70 px-4 py-3 flex flex-wrap items-center gap-3"
      >
        <span className="text-sm text-muted-foreground">Paket aktif kamu:</span>
        <Badge
          variant="outline"
          className={
            currentPlan === "pro" || currentPlan === "admin"
              ? "border-yellow-400/40 bg-yellow-400/10 text-yellow-400"
              : currentPlan === "basic"
              ? "border-blue-400/40 bg-blue-400/10 text-blue-400"
              : "border-border"
          }
        >
          {currentPlan === "admin" ? "Admin ∞" : currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)}
        </Badge>
        {status?.plan_expires_at && (
          <span className="text-xs text-muted-foreground">
            Aktif sampai {formatExpiry(status.plan_expires_at)}
          </span>
        )}
        {isAdmin && (
          <span className="text-xs text-muted-foreground italic">
            Akun admin tidak perlu upgrade — semua fitur sudah diakses.
          </span>
        )}
      </motion.div>

      {/* Plans grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
        {plans.map((plan, idx) => {
          const isCurrent = plan.id === currentPlan || (isAdmin && plan.id === "pro");
          const isHighlighted = plan.highlighted;
          const isLoadingThis = checkoutLoading === plan.id;

          return (
            <motion.div
              key={plan.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.38, delay: 0.1 + idx * 0.07 }}
              className={
                isHighlighted
                  ? "relative rounded-2xl border border-primary/40 bg-primary/5 p-5 sm:p-6 shadow-[0_0_28px_rgba(59,130,246,0.14)]"
                  : "rounded-2xl border border-border bg-card/70 p-5 sm:p-6"
              }
            >
              {isHighlighted && (
                <div className="absolute -top-3 right-4 inline-flex items-center gap-1 rounded-full border border-primary/40 bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                  <Sparkles className="h-3 w-3" /> Populer
                </div>
              )}

              <div className="flex items-center gap-2 mb-1">
                {PLAN_ICONS[plan.id]}
                <p className="text-sm font-semibold text-foreground">{plan.name}</p>
              </div>

              <div className="flex items-end gap-1.5 mt-2">
                <span className="text-2xl sm:text-3xl font-bold text-foreground">{plan.price_label}</span>
                <span className="text-xs text-muted-foreground mb-1">{plan.subtitle}</span>
              </div>

              <div className="mt-5 space-y-2.5">
                {plan.features.map((f) => (
                  <div key={f} className="flex items-start gap-2">
                    <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
                      <Check className="h-3 w-3" />
                    </span>
                    <span className="text-sm text-muted-foreground">{f}</span>
                  </div>
                ))}
              </div>

              <div className="mt-6">
                {isAdmin ? (
                  <Button size="sm" variant="outline" className="w-full opacity-60 cursor-default" disabled>
                    Admin — Already Unlocked
                  </Button>
                ) : isCurrent ? (
                  <Button size="sm" variant="outline" className="w-full" disabled>
                    Paket Aktif
                  </Button>
                ) : plan.id === "free" ? (
                  <Button size="sm" variant="ghost" className="w-full opacity-70" disabled>
                    Gratis selamanya
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant={isHighlighted ? "default" : "outline"}
                    className="w-full"
                    disabled={!!checkoutLoading}
                    onClick={() => handleCheckout(plan.id)}
                  >
                    {isLoadingThis ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : null}
                    {isLoadingThis ? "Membuka checkout..." : `Upgrade ke ${plan.name}`}
                  </Button>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Fine print */}
      <p className="text-xs text-muted-foreground text-center px-4">
        Pembayaran melalui Louvin.dev · IDR · Automatic plan activation setelah pembayaran sukses.
        Langganan berlaku 30 hari.
      </p>
    </div>
  );
}
