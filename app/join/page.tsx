import type { Metadata } from "next";
import Workspace from "../workspace";

export const metadata: Metadata = {
  title: "Join Mobius · Buying group",
  description: "Create your Mobius account. Verify your email and request administrator approval to join the buying group.",
};

export default function JoinPage() {
  return <Workspace signup />;
}
