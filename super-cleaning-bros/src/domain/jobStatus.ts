import type { Job, JobStatus } from "./types.ts";

export const NEXT_STATUS: Record<JobStatus, readonly JobStatus[]> = {
  scheduled: ["on_my_way", "in_progress"],
  on_my_way: ["in_progress", "scheduled"],
  in_progress: ["done", "on_my_way"],
  done: ["in_progress"],
};

export function isJobStatus(value: unknown): value is JobStatus {
  return value === "scheduled" || value === "on_my_way" || value === "in_progress" || value === "done";
}

/** GoHighLevel has one conversation per contact. File inbound replies on the live job. */
export function activeJobForContact(jobs: readonly Job[], nowIso: string): Job | null {
  const live = jobs.find((job) => job.status === "on_my_way" || job.status === "in_progress");
  if (live) return live;
  const upcoming = jobs
    .filter((job) => job.status === "scheduled" && !job.unscheduled && job.scheduledStart >= nowIso)
    .sort((left, right) => left.scheduledStart.localeCompare(right.scheduledStart));
  if (upcoming[0]) return upcoming[0];
  return jobs[0] ?? null;
}
