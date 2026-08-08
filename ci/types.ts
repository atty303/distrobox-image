export type TriggerRole = "build" | "gate" | "input";
export type TriggerType =
  | "github-release"
  | "aur-version"
  | "oci-digest"
  | "repo-path"
  | "git-commit"
  | "manual";

export interface Trigger {
  id: string;
  type: TriggerType;
  role: TriggerRole;
  repository?: string;
  package?: string;
  image?: string;
  channel?: "stable" | "prerelease";
  matches?: string;
  paths?: string[];
  monthly?: boolean;
  build_arg?: string;
  revision_arg?: string;
  asset_pattern?: string;
  url_arg?: string;
  checksum_arg?: string;
  lock_prefix?: string;
  ref?: string;
}

export interface ImageManifest {
  schema: number;
  name: string;
  repository: string;
  context: string;
  containerfile: string;
  tag: string;
  parent?: { image?: string; external?: string; propagation: "immediate" | "on-next-build" };
  triggers: Trigger[];
  reference?: { file: string; section: string; nvidia_section?: string };
  smoke: Array<{ command: string[] }>;
  lock_fields: string[];
  directory: string;
}

export interface ImageLock {
  schema: number;
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
  action: "build" | "verify" | "skip" | "wait";
  reason: string;
  eventKey?: string;
  tag?: string;
  lock?: ImageLock;
}

export interface RegistryState {
  exists(repository: string, tag: string): Promise<boolean>;
  verified(repository: string, tag: string): Promise<boolean>;
}
