"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (mode === "register") {
        // Register first
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password }),
        });

        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Registration failed");
          setLoading(false);
          return;
        }
      }

      // Sign in
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError(mode === "login" ? "Invalid email or password" : "Login after registration failed");
      } else {
        router.push("/");
        router.refresh();
      }
    } catch {
      setError("Something went wrong. Please try again.");
    }

    setLoading(false);
  };

  const handleGoogleSignIn = () => {
    signIn("google", { callbackUrl: "/" });
  };

  const passwordStrength = (p: string) => {
    let score = 0;
    if (p.length >= 6) score++;
    if (p.length >= 10) score++;
    if (/[A-Z]/.test(p)) score++;
    if (/[0-9]/.test(p)) score++;
    if (/[^A-Za-z0-9]/.test(p)) score++;
    return score;
  };

  const strength = passwordStrength(password);
  const strengthColors = ["#ef4444", "#f59e0b", "#eab308", "#22c55e", "#06b6d4"];
  const strengthLabels = ["Very weak", "Weak", "Fair", "Strong", "Very strong"];

  return (
    <div className="login-page">
      <div className="login-container">
        {/* Logo */}
        <div className="login-logo">
          <h1>The Vibe Suite</h1>
          <p>AI Voice Platform</p>
        </div>

        {/* Auth Card */}
        <div className="login-card">
          <h2>{mode === "login" ? "Welcome back" : "Create your account"}</h2>
          <p className="login-subtitle">
            {mode === "login"
              ? "Sign in to access your voice tools"
              : "Get started with 3 free credits"}
          </p>

          {/* Google Sign In */}
          <button className="login-google-btn" onClick={handleGoogleSignIn} type="button">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>

          <div className="login-divider">
            <span>or</span>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit}>
            {mode === "register" && (
              <div className="form-group">
                <label className="form-label">Name</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  id="register-name"
                />
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                className="form-input"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                id="login-email"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                className="form-input"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                id="login-password"
              />
            </div>

            {/* Password strength indicator on register */}
            {mode === "register" && password.length > 0 && (
              <div className="password-strength">
                <div className="strength-bars">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="strength-bar"
                      style={{
                        background: i < strength ? strengthColors[strength - 1] : "var(--bg-card)",
                      }}
                    />
                  ))}
                </div>
                <span className="strength-label" style={{ color: strengthColors[strength - 1] || "var(--text-muted)" }}>
                  {password.length > 0 ? strengthLabels[strength - 1] || "Too short" : ""}
                </span>
              </div>
            )}

            {error && <div className="login-error">{error}</div>}

            <button
              className="btn btn-primary btn-lg w-full"
              type="submit"
              disabled={loading}
              id="login-submit"
            >
              {loading
                ? "⏳ Please wait..."
                : mode === "login"
                ? "Sign In"
                : "Create Account"}
            </button>
          </form>

          {/* Toggle mode */}
          <div className="login-toggle">
            {mode === "login" ? (
              <p>
                Don&apos;t have an account?{" "}
                <button onClick={() => { setMode("register"); setError(""); }}>
                  Sign up
                </button>
              </p>
            ) : (
              <p>
                Already have an account?{" "}
                <button onClick={() => { setMode("login"); setError(""); }}>
                  Sign in
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
