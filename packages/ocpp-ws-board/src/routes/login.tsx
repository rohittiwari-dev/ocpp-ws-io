import {
  IconAlertTriangle,
  IconBolt,
  IconChevronRight,
  IconKey,
  IconLock,
  IconShieldCheck,
  IconUser,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { session, isLoading, login } = useAuth();
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isLoading && session?.authenticated) {
      navigate("/overview", { replace: true });
    }
  }, [session, isLoading, navigate]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Spinner className="size-8" />
      </div>
    );
  }

  const authMode = session?.authMode ?? "token";
  const isTokenMode = authMode === "token";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (isTokenMode) {
        await login({ token });
      } else {
        await login({ username, password });
      }
      navigate("/overview", { replace: true });
    } catch (err: any) {
      setError(err.message || "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-transparent relative overflow-hidden">
      <div className="absolute inset-0 bg-dot-pattern-lg mask-[radial-gradient(ellipse_at_center,black_30%,transparent_80%)] opacity-30 pointer-events-none z-0" />

      {/* Ambient gradients */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="absolute -top-[10%] -left-[5%] w-[500px] h-[500px] rounded-full bg-violet-600/30 blur-[130px] animate-blob" />
        <div className="absolute top-[30%] -right-[10%] w-[450px] h-[600px] rounded-full bg-rose-500/25 blur-[120px] animate-blob animation-delay-2000" />
        <div className="absolute -bottom-[20%] left-[10%] w-[600px] h-[400px] rounded-full bg-orange-600/30 blur-[140px] animate-blob animation-delay-4000" />
      </div>

      {/* Left branding panel */}
      <div className="hidden lg:flex lg:w-[52%] relative border-r border-border/40 z-10 items-center justify-center">
        <div className="relative z-10 flex flex-col justify-center px-16 max-w-xl">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-12">
            <div className="p-2.5 rounded-xl bg-primary shadow-lg shadow-primary/25 flex items-center justify-center">
              <IconBolt className="size-7 text-primary-foreground" />
            </div>
            <span className="text-2xl font-heading font-black tracking-tighter">
              ocpp-ws-io
            </span>
          </div>

          {/* Headline */}
          <h1 className="text-5xl font-heading font-bold tracking-tight leading-[1.08] mb-5">
            Real-time OCPP{" "}
            <span className="text-transparent bg-clip-text bg-linear-to-r from-primary via-chart-4 to-primary">
              Observability
            </span>
          </h1>
          <p className="text-muted-foreground text-lg leading-relaxed max-w-md mb-10">
            Monitor WebSocket traffic, track charging sessions, and manage your
            EV infrastructure — all from a single dashboard.
          </p>

          {/* Feature pills */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center size-9 rounded-lg bg-chart-1/10 shrink-0">
                <div className="size-2.5 rounded-full bg-emerald-500 animate-pulse" />
              </div>
              <div>
                <p className="text-sm font-semibold">Live WebSocket Streams</p>
                <p className="text-xs text-muted-foreground">
                  Sub-second message inspection & filtering
                </p>
              </div>
            </div>

            <Separator />

            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center size-9 rounded-lg bg-primary/10 shrink-0">
                <IconShieldCheck className="size-4.5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold">Security Monitoring</p>
                <p className="text-xs text-muted-foreground">
                  Track auth events, anomalies & security profiles
                </p>
              </div>
            </div>

            <Separator />

            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center size-9 rounded-lg bg-chart-4/10 shrink-0">
                <IconBolt className="size-4.5 text-chart-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">Station Management</p>
                <p className="text-xs text-muted-foreground">
                  Connect, disconnect & purge from a single view
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right login form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 z-10 relative">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2.5 mb-8 justify-center">
            <div className="p-2 rounded-lg bg-primary shadow-lg shadow-primary/25 flex items-center justify-center">
              <IconBolt className="size-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-heading font-bold tracking-tight">
              ocpp-ws-io
            </span>
          </div>

          <Card className="bg-card/90 dark:bg-card/80 backdrop-blur-2xl border-border/60 dark:border-white/8 shadow-2xl shadow-black/5 dark:shadow-black/40 relative overflow-hidden rounded-2xl">
            <div className="accent-line-top opacity-50" />
            <div className="absolute inset-x-0 -top-8 h-24 bg-mesh-gradient opacity-30 dark:opacity-20 pointer-events-none" />
            <CardHeader className="text-center pb-2 pt-8">
              <div className="mx-auto mb-3 flex items-center justify-center size-12 rounded-xl bg-primary/10 ring-1 ring-primary/20">
                <IconLock className="size-5 text-primary" />
              </div>
              <CardTitle className="text-xl font-heading">
                Secure Terminal
              </CardTitle>
              <CardDescription>
                {isTokenMode
                  ? "Enter your access token to authenticate"
                  : "Sign in with your credentials"}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-6 pb-2">
              <form onSubmit={handleSubmit}>
                <FieldGroup>
                  {isTokenMode ? (
                    <Field>
                      <FieldLabel htmlFor="token">Access Token</FieldLabel>
                      <InputGroup className="h-11 rounded-xl bg-background/50 dark:bg-white/5 border-border/40 dark:border-white/10 focus-within:border-primary/40 transition-colors">
                        <InputGroupAddon>
                          <IconKey />
                        </InputGroupAddon>
                        <InputGroupInput
                          id="token"
                          type="password"
                          placeholder="Enter your access token"
                          value={token}
                          onChange={(e) => setToken(e.target.value)}
                          autoComplete="off"
                          autoFocus
                          required
                          aria-invalid={!!error || undefined}
                        />
                      </InputGroup>
                    </Field>
                  ) : (
                    <>
                      <Field>
                        <FieldLabel htmlFor="username">Username</FieldLabel>
                        <InputGroup className="h-11 rounded-xl bg-background/50 dark:bg-white/5 border-border/40 dark:border-white/10 focus-within:border-primary/40 transition-colors">
                          <InputGroupAddon>
                            <IconUser />
                          </InputGroupAddon>
                          <InputGroupInput
                            id="username"
                            type="text"
                            placeholder="Enter your username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            autoComplete="username"
                            autoFocus
                            required
                            aria-invalid={!!error || undefined}
                          />
                        </InputGroup>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="password">Password</FieldLabel>
                        <InputGroup className="h-11 rounded-xl bg-background/50 dark:bg-white/5 border-border/40 dark:border-white/10 focus-within:border-primary/40 transition-colors">
                          <InputGroupAddon>
                            <IconLock />
                          </InputGroupAddon>
                          <InputGroupInput
                            id="password"
                            type="password"
                            placeholder="Enter your password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoComplete="current-password"
                            required
                            aria-invalid={!!error || undefined}
                          />
                        </InputGroup>
                      </Field>
                    </>
                  )}

                  {error && (
                    <Alert variant="destructive">
                      <IconAlertTriangle />
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <Button
                    type="submit"
                    className="w-full h-11 rounded-xl text-sm font-semibold mt-2"
                    disabled={submitting}
                  >
                    {submitting ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <IconChevronRight data-icon="inline-end" />
                    )}
                    {submitting ? "Authenticating…" : "Enter Dashboard"}
                  </Button>
                </FieldGroup>
              </form>
            </CardContent>
            <CardFooter className="justify-center pb-6">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary">
                  {isTokenMode ? "Token" : "Credentials"}
                </Badge>
                <span>authentication mode</span>
              </div>
            </CardFooter>
          </Card>

          <p className="mt-6 text-center text-xs text-muted-foreground flex items-center justify-center gap-1.5">
            Powered by
            <IconBolt className="size-3 text-primary" />
            <span className="font-medium text-foreground/70">
              ocpp-ws-board
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
