import type { Metadata } from "next";
import { SkillScanner } from "./skill-scanner";

export const metadata: Metadata = {
  title: "SkillInspect — Read the small print before installing an Agent Skill",
  description:
    "Paste a public GitHub Agent Skill URL to reveal commands, credentials, network hosts, file writes, side effects, and static safety findings before installation.",
};

export default function Home() {
  return <SkillScanner />;
}
