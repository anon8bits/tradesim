import { STARTING_CASH_BALANCE_PAISE } from "@tradesim/common";
import { useAccount, usePortfolio } from "../api/queries";
import { initials, useAuth } from "../auth/auth-context";
import { ChevronIcon } from "../components/Icons";
import { config } from "../config";
import { formatRupees, parsePaise } from "../lib/money";
import { useOrderLog } from "../lib/order-log";
import { ThemePreference, useTheme } from "../lib/theme";

const THEMES: Array<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function ProfilePage() {
  const { user, logout } = useAuth();
  const portfolio = usePortfolio();
  const account = useAccount();
  const orders = useOrderLog(user?.sub);
  const [theme, setTheme] = useTheme();
  const data = portfolio.data;

  return (
    <section className="page">
      <div className="page-head">
        <h2>Profile</h2>
      </div>

      <div className="panel">
        <div className="profile-head">
          <div className="avatar">
            {user?.picture ? (
              <img src={user.picture} alt="" referrerPolicy="no-referrer" />
            ) : (
              initials(user)
            )}
          </div>
          <div>
            <h2>{user?.name ?? user?.email ?? "Trader"}</h2>
            {user?.email && <div className="email">{user.email}</div>}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Account</h3>
        </div>
        <div className="kv-list">
          <div className="kv">
            <span className="k">Cash balance</span>
            <span className="v">
              {data ? formatRupees(parsePaise(data.cashBalanceCents)) : "—"}
            </span>
          </div>
          <div className="kv">
            <span className="k">Portfolio value</span>
            <span className="v">
              {data ? formatRupees(parsePaise(data.totalValueCents)) : "—"}
            </span>
          </div>
          <div className="kv">
            <span className="k">Open positions</span>
            <span className="v">{data ? data.holdings.length : "—"}</span>
          </div>
          <div className="kv">
            <span className="k">Orders from this browser</span>
            <span className="v">{orders.length}</span>
          </div>
          <div className="kv">
            <span className="k">Account email</span>
            <span className="v">{account.data?.email ?? "—"}</span>
          </div>
          <div className="kv">
            <span className="k">Member since</span>
            <span className="v">
              {account.data
                ? new Date(account.data.createdAt).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })
                : "—"}
            </span>
          </div>
          <div className="kv">
            <span className="k">Starting capital</span>
            <span className="v">
              {formatRupees(STARTING_CASH_BALANCE_PAISE)}
            </span>
          </div>
          <div className="kv">
            <span className="k">Email verified</span>
            <span className="v">
              {user?.emailVerified == null
                ? "—"
                : user.emailVerified
                  ? "Yes"
                  : "No"}
            </span>
          </div>
          <div className="kv">
            <span className="k">Login ID</span>
            <span className="v">{user?.sub ?? "—"}</span>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Settings</h3>
        </div>
        <div className="settings-list">
          <div className="setting">
            <span>Appearance</span>
            <div className="segmented" role="group" aria-label="Theme">
              {THEMES.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  aria-pressed={theme === option.value}
                  onClick={() => setTheme(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="setting">
            <span>Data source</span>
            <span className="hint">
              {config.mode === "mock"
                ? "Demo data (mock API)"
                : "TradeSim API · NSE via Upstox"}
            </span>
          </div>
          <button type="button" className="setting" onClick={logout}>
            <span className="danger">Log out</span>
            <ChevronIcon />
          </button>
        </div>
      </div>
    </section>
  );
}
