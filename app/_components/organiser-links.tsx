import Link from "next/link";

function OrgLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="text-sm font-medium text-brand hover:text-brand-dark"
    >
      {children} →
    </Link>
  );
}

// The organiser control panel. Shown to the owner (full set) and, in a trimmed
// form, to helpers. Used on the owner-as-player home so an organiser who is also
// playing keeps their tools without a second login.
export function OrganiserLinks({
  isOwner,
  isAdmin,
}: {
  isOwner: boolean;
  isAdmin: boolean;
}) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      <OrgLink href="/schedule">Schedule &amp; fix scores</OrgLink>
      {isOwner && (
        <>
          <OrgLink href="/setup/teams">Teams &amp; logins</OrgLink>
          <OrgLink href="/setup/logins">Logins &amp; passwords</OrgLink>
          <OrgLink href="/setup/event">Edit event details</OrgLink>
          <OrgLink href="/setup/helpers">Manage helpers</OrgLink>
          <OrgLink href="/setup/photo">Photo Bomb emails</OrgLink>
          <OrgLink href="/setup/owner">Account &amp; recovery</OrgLink>
        </>
      )}
      {isAdmin && !isOwner && (
        <OrgLink href="/awards">Awards &amp; voting</OrgLink>
      )}
    </div>
  );
}
