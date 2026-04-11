type FyjobLogoProps = {
  className?: string;
  iconClassName?: string;
  wordmarkClassName?: string;
  compact?: boolean;
};

export const FyjobLogo = ({
  className = "",
  iconClassName = "h-6 w-6",
  wordmarkClassName = "text-xl font-bold tracking-tight",
  compact = false,
}: FyjobLogoProps) => {
  return (
    <div className={`flex items-center gap-3 ${className}`.trim()}>
      <span className={`inline-flex items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20 ${compact ? "p-2" : "p-2.5"}`}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={iconClassName}
          aria-hidden="true"
        >
          <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
          <circle cx="12" cy="14" r="3" />
          <path d="M14 16l3 3" />
        </svg>
      </span>
      <div className="flex flex-col leading-none">
        <span className={wordmarkClassName}>
          FY<span className="text-primary font-black">JOB</span>
        </span>
        {!compact ? <span className="text-[10px] uppercase tracking-[0.35em] text-muted-foreground">Career Intelligence</span> : null}
      </div>
    </div>
  );
};