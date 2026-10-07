import { Link } from "react-router";
import { useAuth } from "../auth/auth-context";
import { BarsIcon, LedgerIcon, TrendIcon } from "../components/Icons";
import { displayName, NSE_TOP_100 } from "../lib/catalog";

const TICKER = NSE_TOP_100.slice(0, 40);

export function LandingPage() {
  const { isAuthenticated, login } = useAuth();

  const start = () => void login({ signup: true });
  const signIn = () => void login();

  return (
    <div className="landing">
      <nav className="l-nav">
        <Link to="/" className="wordmark">
          Trade<em>Sim</em>
        </Link>
        <div className="l-links">
          <a href="#features">Features</a>
          <a href="#how-it-works">How it works</a>
          <a href="#markets">Markets</a>
        </div>
        <div className="l-actions">
          {isAuthenticated ? (
            <Link to="/app" className="btn btn-primary">
              Open dashboard
            </Link>
          ) : (
            <>
              <button type="button" className="btn btn-ghost" onClick={signIn}>
                Log in
              </button>
              <button type="button" className="btn btn-primary" onClick={start}>
                Start trading free
              </button>
            </>
          )}
        </div>
      </nav>

      <header className="hero">
        <h1>
          The market,
          <br />
          <span className="accent-word">minus the risk.</span>
        </h1>
        <p>
          TradeSim gives you ₹1,00,000 in virtual capital and real NSE prices,
          so you can learn how trading actually feels before a single rupee is
          on the line.
        </p>
        <div className="hero-ctas">
          {isAuthenticated ? (
            <Link to="/app" className="btn btn-primary">
              Go to your dashboard
            </Link>
          ) : (
            <button type="button" className="btn btn-primary" onClick={start}>
              Start trading free
            </button>
          )}
          <Link to="/app" className="btn btn-ghost">
            See live markets
          </Link>
        </div>
      </header>

      <div
        className="ticker-wrap"
        id="markets"
        aria-label="Tradable NSE stocks"
      >
        <div className="ticker-track">
          {[0, 1].map((copy) =>
            TICKER.map((entry) => (
              <div
                className="tick"
                key={`${copy}-${entry.tradingSymbol}`}
                aria-hidden={copy === 1}
              >
                <span className="sym">{entry.tradingSymbol}</span>
                <span className="px">{displayName(entry.tradingSymbol)}</span>
              </div>
            )),
          )}
        </div>
      </div>

      <section className="section" id="features">
        <div className="section-head">
          <h2>Built like a real trading desk</h2>
          <p>
            Not a spreadsheet with extra steps. TradeSim is built on the same
            ideas real brokerages use.
          </p>
        </div>
        <div className="feature-grid">
          <div className="feature">
            <TrendIcon className="ico" />
            <h3>Live NSE prices</h3>
            <p>
              Streamed tick by tick from a real market-data feed for 100 of
              India's most traded stocks.
            </p>
          </div>
          <div className="feature">
            <LedgerIcon className="ico" />
            <h3>Orders that fill correctly</h3>
            <p>
              Every trade is queued, checked, and settled atomically, so your
              balance is always right, even under load.
            </p>
          </div>
          <div className="feature">
            <BarsIcon className="ico" />
            <h3>A portfolio you can trust</h3>
            <p>
              Exact cost basis and unrealized P&amp;L to the paisa, the way a
              real brokerage statement would show it.
            </p>
          </div>
        </div>
      </section>

      <section className="section" id="how-it-works" style={{ paddingTop: 0 }}>
        <div className="section-head">
          <h2>Three steps to your first trade</h2>
        </div>
        <div className="steps">
          <div className="step">
            <div className="n">01</div>
            <h3>Create a free account</h3>
            <p>Sign in securely in under a minute, no card required.</p>
          </div>
          <div className="step">
            <div className="n">02</div>
            <h3>Get ₹1,00,000 in virtual cash</h3>
            <p>
              Your starting balance is ready to deploy across 100 NSE stocks.
            </p>
          </div>
          <div className="step">
            <div className="n">03</div>
            <h3>Buy, sell, and learn</h3>
            <p>
              Place market orders and watch how your decisions play out in real
              prices.
            </p>
          </div>
        </div>
      </section>

      <div className="cta-band">
        <div>
          <h2>Ready to place your first paper trade?</h2>
          <p>Real prices. Virtual money. Zero risk.</p>
        </div>
        {isAuthenticated ? (
          <Link to="/app" className="btn btn-primary">
            Open dashboard
          </Link>
        ) : (
          <button type="button" className="btn btn-primary" onClick={start}>
            Start trading free
          </button>
        )}
      </div>

      <footer className="l-footer">
        <div className="wordmark" style={{ fontSize: "1rem" }}>
          Trade<em>Sim</em>
        </div>
        <div>
          Paper trading for people learning to read the market. Not investment
          advice.
        </div>
      </footer>
    </div>
  );
}
