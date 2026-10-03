import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { readAuthConfig } from "@/auth/config";
import { isInitialized } from "@/auth/server";
export const dynamic = "force-dynamic";
export default function RegisterPage() {
  return <main className="auth-page"><div className="auth-container"><p className="brand">Homebooks</p><section className="auth-panel">
    {isInitialized() && readAuthConfig().registrationEnabled ? <AuthForm mode="register" /> : <><h1>Registration is unavailable</h1><p>Ask your household admin to enable registration.</p></>}
    <p><Link href="/sign-in">Back to sign in</Link></p>
  </section></div></main>;
}
