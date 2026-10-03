/** Contact form vocabulary shared by the form and its API route (client-safe). */

export const CONTACT_TOPICS = [
  { value: "general", label: "General question" },
  { value: "advertising", label: "Advertising" },
  { value: "feature", label: "Feature suggestion" },
  { value: "data", label: "A wrong or missing earnings date" },
  { value: "bug", label: "Something's broken" },
  { value: "other", label: "Other" },
] as const;

export type ContactTopic = (typeof CONTACT_TOPICS)[number]["value"];

export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 5000;

export function topicLabel(topic: string): string {
  return CONTACT_TOPICS.find((t) => t.value === topic)?.label ?? "Message";
}
