import { LoginForm } from "./_components/login-form";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-md">
        <header className="text-center">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-brand">
            7th edition
          </p>
          <h1 className="mt-2 text-5xl font-bold tracking-tight">
            Spring <span className="text-brand">Bowls</span>
          </h1>
          <div className="mt-4 flex justify-center">
            <span className="rounded-full bg-white px-3 py-1 text-sm font-medium shadow-sm ring-1 ring-black/5">
              🇬🇧 BYO Brit edition 🥝
            </span>
          </div>
          <p className="mt-4 text-base text-foreground/70">
            Saturday 1 August 2026
          </p>
          <p className="mx-auto mt-1 max-w-xs text-sm text-foreground/60">
            Your next game, live scores, group tables and the awards — all in
            one place.
          </p>
        </header>

        <section className="mt-8 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
          <h2 className="text-lg font-semibold">Log in</h2>
          <p className="mt-1 text-sm text-foreground/60">
            Use the username and password from your card.
          </p>
          <LoginForm />
        </section>

        <p className="mt-6 text-center text-xs text-foreground/50">
          See you on the green.
        </p>
      </div>
    </main>
  );
}
