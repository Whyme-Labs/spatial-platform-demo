import { detailLine, element, taskDisclosure, workspaceTask } from "../ui/dom";

export type ProcessHistoryJob = {
  job_type: string;
  state: string;
  progress: number;
  progress_message: string | null;
};

type ProcessVersion = {
  version_number: number;
};

export type ProcessWorkspaceModel =
  | { kind: "empty"; title: "Waiting for processing"; detail: string }
  | { kind: "working"; title: string; job: ProcessHistoryJob }
  | { kind: "blocked"; title: "Processing needs attention"; detail: string }
  | { kind: "complete"; title: "Visual scene prepared"; version: ProcessVersion };

type RenderProcessWorkspaceInput = {
  container: HTMLElement;
  jobs: readonly ProcessHistoryJob[];
  process: ProcessWorkspaceModel;
  humanStatus: (status: string) => string;
};

export function renderProcessWorkspace({
  container,
  jobs,
  process,
  humanStatus,
}: RenderProcessWorkspaceInput): void {
  const task = workspaceTask("process-task");
  task.append(element("span", "eyebrow", "CURRENT PROCESSING STATE"));
  task.append(element("h3", "", process.title));
  if (process.kind === "working") {
    task.append(element(
      "p",
      "muted-copy",
      process.job.progress_message ?? `${process.job.progress}% complete`,
    ));
    const progress = element("div", "mini-progress");
    const fill = element("i");
    fill.style.width = `${process.job.progress}%`;
    progress.append(fill);
    task.append(progress);
  } else if (process.kind === "complete") {
    task.append(element(
      "p",
      "muted-copy",
      `Version ${process.version.version_number} has a verified browser scene. Structure and publication checks continue in their own workspaces.`,
    ));
  } else {
    task.append(element("p", "muted-copy", process.detail));
  }

  const history = taskDisclosure("process-history");
  history.append(element("summary", "", "Processing history"));
  const rows = element("div", "process-history-rows");
  for (const job of jobs) {
    rows.append(detailLine(
      `${humanStatus(job.job_type)} · ${humanStatus(job.state)} · ${job.progress_message ?? `${job.progress}% complete`}`,
    ));
  }
  if (!jobs.length) rows.append(element("p", "muted-copy", "No project processing jobs are recorded yet."));
  history.append(rows);
  container.replaceChildren(task, history);
}
