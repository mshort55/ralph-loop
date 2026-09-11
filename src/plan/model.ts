export type ValidationMode = "conversion" | "runtime";

export interface Story {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  nonGoals: string[];
  checks: string[];
  references: string[];
  dependencies: string[];
  priority: number;
  passes: boolean;
  notes: string;
}

export interface Plan {
  schemaVersion: 1;
  project: string;
  branchName: string;
  description: string;
  userStories: Story[];
}
