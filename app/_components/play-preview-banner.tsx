import { StartTournamentButton } from "./start-tournament-button";

export function PlayPreviewBanner({
  openTimeLabel,
  isOwner,
}: {
  openTimeLabel: string;
  isOwner: boolean;
}) {
  return (
    <section className="rounded-2xl bg-amber-50 p-5 text-center ring-1 ring-amber-200">
      <p className="text-2xl">🔒</p>
      <p className="mt-1 font-display text-xl font-semibold text-amber-950">
        Fixtures go live at {openTimeLabel}
      </p>
      <p className="mt-1 text-sm text-amber-900/75">
        The draw is ready to explore. Score entry and voting stay locked until
        the organiser starts play.
      </p>
      {isOwner && (
        <div className="mt-4">
          <StartTournamentButton />
        </div>
      )}
    </section>
  );
}
