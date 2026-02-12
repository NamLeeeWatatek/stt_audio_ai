export function ScriberrTextLogo({ className = "" }: { className?: string }) {

  return (
    <div className={`${className} font-display font-bold text-xl tracking-tight transition-all duration-300 pointer-events-none select-none flex items-center`}>
      <span className="text-[var(--text-primary)]">Wata</span>
      <span className="ml-1.5 bg-gradient-to-br from-[#FFAB40] to-[#FF3D00] bg-clip-text text-transparent">Meeting Notes</span>
    </div>
  );
}
