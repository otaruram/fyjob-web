import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Wallet, QrCode, Smartphone, Loader2, ArrowLeft, ShieldCheck, Landmark, Clock } from "lucide-react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { createPaymentTransaction } from "@/lib/api";

type PaymentMethodValue = "qris" | "gopay";

const PAYMENT_METHODS: Array<{ value: PaymentMethodValue; label: string; icon: React.ReactNode; group: "ewallet" }> = [
  { value: "qris", label: "QRIS", icon: <QrCode className="h-4 w-4" />, group: "ewallet" },
  { value: "gopay", label: "GoPay", icon: <Smartphone className="h-4 w-4" />, group: "ewallet" },
];

const TBA_METHODS: Array<{ label: string; subtitle: string; icon: React.ReactNode }> = [
  { label: "ShopeePay", subtitle: "Instant e-wallet / QR", icon: <Smartphone className="h-4 w-4" /> },
  { label: "BNI VA", subtitle: "Virtual account bank", icon: <Landmark className="h-4 w-4" /> },
  { label: "BRI VA", subtitle: "Virtual account bank", icon: <Landmark className="h-4 w-4" /> },
  { label: "Permata VA", subtitle: "Virtual account bank", icon: <Landmark className="h-4 w-4" /> },
  { label: "CIMB Niaga VA", subtitle: "Virtual account bank", icon: <Landmark className="h-4 w-4" /> },
];

const PLAN_META = {
  basic: { name: "Basic", priceLabel: "Rp29.000", period: "/bulan" },
  pro: { name: "Pro", priceLabel: "Rp79.000", period: "/bulan" },
} as const;

export default function Checkout() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const { toast } = useToast();

  const plan = (searchParams.get("plan") || "basic").toLowerCase() as "basic" | "pro";
  const safePlan = plan === "pro" ? "pro" : "basic";

  const defaultMethod = useMemo<PaymentMethodValue>(() => (isMobile ? "gopay" : "qris"), [isMobile]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodValue>(defaultMethod);
  const [isPaying, setIsPaying] = useState(false);

  const meta = PLAN_META[safePlan];
  const selectedMethod = PAYMENT_METHODS.find((m) => m.value === paymentMethod);

  const handlePay = async () => {
    setIsPaying(true);
    try {
      const result = await createPaymentTransaction(
        safePlan,
        `${window.location.origin}/dashboard/upgrade?payment=success`,
        `${window.location.origin}/dashboard/upgrade?payment=cancel`,
        paymentMethod
      );

      if (result.checkout_url) {
        window.location.href = result.checkout_url;
        return;
      }

      if (result.actions?.length) {
        const actionUrl = result.actions.find((a) => a.url)?.url;
        if (actionUrl) {
          window.location.href = actionUrl;
          return;
        }
      }

      throw new Error("Link pembayaran belum tersedia untuk metode ini. Coba metode lain.");
    } catch (e: any) {
      toast({
        title: "Checkout gagal",
        description: e.message || "Coba metode pembayaran lain.",
        variant: "destructive",
      });
      setIsPaying(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="terminal-kicker mb-2">checkout</p>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Pembayaran Paket {meta.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">Pilih metode paling nyaman, lalu lanjutkan ke halaman pembayaran.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate("/dashboard/upgrade")}> 
            <ArrowLeft className="h-4 w-4 mr-2" /> Kembali
          </Button>
        </div>

        <section className="terminal-shell p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
              {meta.name}
            </Badge>
            <span className="text-2xl font-bold text-foreground">{meta.priceLabel}</span>
            <span className="text-sm text-muted-foreground">{meta.period}</span>
            <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
              <ShieldCheck className="h-4 w-4" /> Secure by Louvin
            </span>
          </div>

          <div>
            <p className="text-sm font-medium mb-2">Metode Pembayaran</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {PAYMENT_METHODS.map((method) => {
                const active = paymentMethod === method.value;
                return (
                  <button
                    key={method.value}
                    type="button"
                    onClick={() => setPaymentMethod(method.value)}
                    className={active
                      ? "rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-left"
                      : "rounded-lg border border-border bg-card/70 px-3 py-2 text-left hover:bg-card"
                    }
                  >
                    <span className="inline-flex items-center gap-2 text-sm font-medium">
                      {method.icon} {method.label}
                    </span>
                    <span className="block text-xs text-muted-foreground mt-1">
                      Instant e-wallet / QR
                    </span>
                  </button>
                );
              })}
              {TBA_METHODS.map((method) => (
                <button
                  key={method.label}
                  type="button"
                  disabled
                  className="rounded-lg border border-border bg-card/40 px-3 py-2 text-left opacity-50 cursor-not-allowed"
                >
                  <span className="inline-flex items-center gap-2 text-sm font-medium">
                    {method.icon} {method.label}
                    <Badge variant="outline" className="ml-auto text-[10px] px-1.5 py-0 border-muted-foreground/30">
                      <Clock className="h-3 w-3 mr-0.5" /> TBA
                    </Badge>
                  </span>
                  <span className="block text-xs text-muted-foreground mt-1">
                    {method.subtitle}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card/60 p-3 text-sm text-muted-foreground">
            Metode terpilih: <span className="font-medium text-foreground inline-flex items-center gap-1">{selectedMethod?.icon} {selectedMethod?.label}</span>
          </div>

          <Button className="w-full sm:w-auto" onClick={handlePay} disabled={isPaying}>
            {isPaying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wallet className="h-4 w-4 mr-2" />}
            {isPaying ? "Membuka pembayaran..." : `Bayar ${meta.priceLabel}`}
          </Button>
        </section>
      </div>
    </DashboardLayout>
  );
}