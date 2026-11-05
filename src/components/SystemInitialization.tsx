import emblem from "@/assets/waypoint-emblem.png";
import "./system-initialization.css";

/** Indeterminate status, never an assertion that credentials were verified. */
export default function SystemInitialization({ appearanceReady, initialized, error, onRetry }: {
  appearanceReady: boolean;
  initialized: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const status = error ? "LOCAL INITIALIZATION UNAVAILABLE" : initialized ? "OPERATOR GATE / READY" : appearanceReady ? "LOADING OPERATOR INTERFACE" : "INITIALIZING LOCAL CONSOLE";
  return (
    <main className="system-init" aria-label="WAYPOINT system initialization">
      <div className="system-init-grid" aria-hidden="true" />
      <header className="system-init-header"><span>WAYPOINT SYSTEMS</span><span>LOCAL CONSOLE / 01</span></header>
      <div className="system-init-content">
        <div className="system-init-stage" aria-hidden="true">
          <div className="system-init-ring system-init-ring-outer" /><div className="system-init-ring system-init-ring-inner" />
          <span className="system-init-cross system-init-cross-top">+</span><span className="system-init-cross system-init-cross-bottom">+</span>
          <span className="system-init-line system-init-line-left" /><span className="system-init-line system-init-line-right" />
          <div className="system-init-logo"><img src={emblem} alt="" /><span className="system-init-sweep" /></div>
          <span className="system-init-corner system-init-corner-tl" /><span className="system-init-corner system-init-corner-br" />
        </div>
        <div className="system-init-heading">WAYPOINT <span> / </span> SYSTEMS</div>
        <div className="system-init-subheading">PERSONAL OPERATIONS CONSOLE</div>
        <div className="system-init-status" role={error ? "alert" : "status"} aria-live="polite"><span className="system-init-dot" />{status}</div>
        <div className="system-init-progress" aria-hidden="true"><span /></div>
        {error && <div className="system-init-error"><p>Unable to initialize the local operator interface.</p><button type="button" onClick={onRetry}>RETRY INITIALIZATION <span aria-hidden="true">↗</span></button></div>}
      </div>
      <footer className="system-init-footer"><span>LOCAL SYSTEM / LOCAL MODE</span><span>WAYPOINT // INITIALIZATION</span></footer>
    </main>
  );
}
