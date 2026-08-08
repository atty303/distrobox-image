export type TriggerRole = "build" | "gate" | "input";

interface TriggerBase {
  id: string;
  role: TriggerRole;
  build_arg?: string;
  revision_arg?: string;
  label?: string;
  label_source?: "value" | "revision";
}

export interface GitHubReleaseTrigger extends TriggerBase {
  type: "github-release";
  repository: string;
  channel?: "stable" | "prerelease";
  asset_pattern?: string;
  url_arg?: string;
  checksum_arg?: string;
}

export interface AurVersionTrigger extends TriggerBase {
  type: "aur-version";
  package: string;
  matches?: string;
}

export interface OciDigestTrigger extends TriggerBase {
  type: "oci-digest";
  image: string;
  monthly?: boolean;
}

export interface GitCommitTrigger extends TriggerBase {
  type: "git-commit";
  repository: string;
  ref?: string;
}

export type Trigger =
  | GitHubReleaseTrigger
  | AurVersionTrigger
  | OciDigestTrigger
  | GitCommitTrigger;

export interface SmokeCommand {
  command: string[];
}

export interface ImageManifest {
  schema: 2;
  name: string;
  repository: string;
  context: string;
  containerfile: string;
  tag: string;
  parent?: {
    image?: string;
    external?: string;
    propagation: "on-next-build";
  };
  triggers: Trigger[];
  reference?: { section: string; nvidia_section?: string };
  smoke: SmokeCommand[];
  reference_smoke: SmokeCommand[];
  directory: string;
}

export interface ImageLock {
  schema: 2;
  image: string;
  inputs: Record<string, string>;
  build_args: Record<string, string>;
  expected: Record<string, string>;
}

export interface ResolvedValue {
  value: string;
  revision?: string;
  metadata?: Record<string, string>;
}

export interface PlanItem {
  image: string;
  repository: string;
  action: "build" | "skip" | "wait";
  reason: string;
  eventKey?: string;
  tag?: string;
  lock?: ImageLock;
  manualReason?: string;
}

export interface RegistryState {
  exists(repository: string, tag: string): Promise<boolean>;
}
