import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { readAuthConfig } from "@/auth/config";
import { isInitialized } from "@/auth/server";
export const dynamic = "force-dynamic";
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ setup?: string; registered?: string; expired?: string }> }) {
  const params = await searchParams;
  const initialized = isInitialized();
  return <main className="auth-page"><div className="auth-container"><p className="brand">Homebooks</p><section className="auth-panel">
    {(params.setup || params.registered) && <p role="status">Account created. Sign in to continue.</p>}
    <AuthForm mode="sign-in" expired={params.expired === "1"} />
    {!initialized ? <p><Link href="/setup">Set up this instance</Link></p> : readAuthConfig().registrationEnabled
      ? <p><Link href="/register">Create account</Link></p> : <p className="hint">Ask your household admin to enable registration.</p>}
  </section></div></main>;
}
