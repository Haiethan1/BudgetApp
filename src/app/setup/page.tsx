import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { isInitialized } from "@/auth/server";
export const dynamic = "force-dynamic";
export default function SetupPage() {
  return <main className="auth-page"><div className="auth-container"><p className="brand">Homebooks</p><section className="auth-panel">
    {isInitialized() ? <><h1>Setup is complete</h1><p>Sign in with your existing account.</p><Link href="/sign-in">Sign in</Link></> : <AuthForm mode="setup" />}
    <p><Link href="/sign-in">Back to sign in</Link></p>
  </section></div></main>;
}
