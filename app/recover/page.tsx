import Link from "next/link";
import { RecoverForm } from "./_form";

export default function RecoverPage() {
  return (
    <main className="flex flex-1 flex-col items-center px-5 py-10">
      <div className="w-full max-w-md">
        <header className="text-center">
          <Link
            href="/"
            className="text-sm text-foreground/50 hover:text-foreground/80"
          >
            ← back to log in
          </Link>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            Reset your password
          </h1>
          <p className="mt-2 text-sm text-foreground/60">
            Enter your username, your recovery code, and a new password.
          </p>
        </header>

        <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
          <RecoverForm />
        </section>
      </div>
    </main>
  );
}
