import type { Metadata } from "next";
import MemberProfile from "./member-profile";

export const metadata: Metadata = { title: "Member profile · Mobius" };

export default function ProfilePage() {
  return <MemberProfile />;
}
