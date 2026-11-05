import logo from "@/assets/waypoint-operations-console-logo.png";
import "./light-system-initialization.css";

/** Independent light-mode sequence; state labels report actual initialization. */
export default function LightSystemInitialization({ initialized, error, onRetry }: {
  initialized: boolean; error: boolean; onRetry: () => void;
}) {
  const status = error ? "LOCAL INITIALIZATION UNAVAILABLE" : initialized ? "OPERATOR GATE / READY" : "LOADING OPERATOR INTERFACE";
  return (
    <main className="light-boot" aria-label="WAYPOINT system initialization">
      <div className="light-boot-grid" aria-hidden="true" />
      <header className="light-boot-header"><span>WAYPOINT / SYSTEMS</span><span>OPERATIONS CONSOLE &nbsp; // &nbsp; 01</span></header>
      <div className="light-boot-body">
        <div className="light-boot-frame" aria-hidden="true">
          <div className="light-boot-axis light-boot-axis-h" /><div className="light-boot-axis light-boot-axis-v" />
          <div className="light-boot-measure light-boot-measure-l">01<br />—<br />04</div><div className="light-boot-measure light-boot-measure-r">SYS<br />—<br />RDY</div>
          <div className="light-boot-bracket light-boot-bracket-tl" /><div className="light-boot-bracket light-boot-bracket-br" />
          <div className="light-boot-art"><img src={logo} alt="" /><span className="light-boot-sweep" /></div>
        </div>
        <div className="light-boot-caption"><span>WAYPOINT / SYSTEM INITIALIZATION</span><span>LOCAL SYSTEM</span></div>
        <div className="light-boot-status" role={error ? "alert" : "status"} aria-live="polite"><i />{status}</div>
        <div className="light-boot-progress" aria-hidden="true"><span /></div>
        {error && <div className="light-boot-error"><p>Unable to initialize the local operator interface.</p><button type="button" onClick={onRetry}>RETRY INITIALIZATION <span aria-hidden="true">↗</span></button></div>}
      </div>
      <footer className="light-boot-footer"><span>LOCAL SYSTEM / LOCAL MODE</span><span>WAYPOINT // INITIALIZATION</span></footer>
    </main>
  );
}
